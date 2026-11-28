import unittest
from unittest.mock import AsyncMock, patch

from web_scroll import WebScroller


class WebScrollTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.scroller = WebScroller()
        self.socket = AsyncMock()
        self.socket.closed = False
        self.socket.receive_json.return_value = {"id": 1, "result": {}}

        async def connect(url, title=""):
            self.scroller._url = url
            self.scroller._title = title
            self.scroller._socket = self.socket

        self.connect = patch.object(self.scroller, "_connect", side_effect=connect)
        self.connection = self.connect.start()
        self.fullscreen_detection = patch.object(self.scroller, "_video_fullscreen", AsyncMock(return_value=False))
        self.video_fullscreen = self.fullscreen_detection.start()

    async def asyncTearDown(self):
        await self.scroller.close()
        self.connect.stop()
        self.fullscreen_detection.stop()

    async def test_native_wheel_has_direction_speed_and_page_center(self):
        await self.scroller.scroll("https://guide.example/", 0.5, 1, 506, 534)
        event = self.socket.send_json.call_args.args[0]
        self.assertEqual(event["method"], "Input.dispatchMouseEvent")
        self.assertEqual(event["params"], {"type": "mouseWheel", "x": 253, "y": 267,
                         "deltaX": 48, "deltaY": 96, "modifiers": 0})
        self.socket.receive_json.return_value = {"id": 2, "result": {}}
        await self.scroller.scroll("https://guide.example/", 0, -0.5, 506, 534)
        self.connection.assert_awaited_once()
        self.assertEqual(self.socket.send_json.call_args.args[0]["params"]["deltaY"], -48)

    async def test_idle_does_not_connect_or_send_events(self):
        await self.scroller.scroll("https://guide.example/", 0, 0, 506, 534)
        self.connection.assert_not_called()

    async def test_fullscreen_stick_maps_four_directions_to_native_video_keys(self):
        self.video_fullscreen.return_value = True
        self.socket.receive_json.side_effect = [{"id": i} for i in range(1, 9)]
        for x, y, key in [(1, 0, "ArrowRight"), (-1, 0, "ArrowLeft"),
                          (0, -1, "ArrowUp"), (0, 1, "ArrowDown")]:
            await self.scroller.scroll("https://video.example/", x, y, 506, 500)
            events = [call.args[0] for call in self.socket.send_json.call_args_list[-2:]]
            self.assertEqual([event["params"]["type"] for event in events], ["keyDown", "keyUp"])
            self.assertTrue(all(event["params"]["code"] == key for event in events))
            self.assertTrue(all(event["method"] == "Input.dispatchKeyEvent" for event in events))

    async def test_fullscreen_hold_is_throttled_and_exit_restores_wheel_immediately(self):
        self.video_fullscreen.return_value = True
        self.socket.receive_json.side_effect = [{"id": i} for i in range(1, 6)]
        with patch("web_scroll.monotonic", side_effect=[10, 10.1, 10.3]):
            for _ in range(3):
                await self.scroller.scroll("https://video.example/", 1, 0, 506, 500)
        self.assertEqual(self.socket.send_json.await_count, 4)
        self.video_fullscreen.return_value = False
        await self.scroller.scroll("https://video.example/", 1, 0, 506, 500)
        self.assertEqual(self.socket.send_json.call_args.args[0]["method"], "Input.dispatchMouseEvent")

    async def test_fullscreen_uses_dominant_axis_and_ignores_small_motions(self):
        self.video_fullscreen.return_value = True
        await self.scroller.scroll("https://video.example/", 0.1, 0.2, 506, 500)
        self.socket.send_json.assert_not_called()
        self.socket.receive_json.side_effect = [{"id": 1}, {"id": 2}]
        await self.scroller.scroll("https://video.example/", 0.5, -0.9, 506, 500)
        self.assertEqual(self.socket.send_json.call_args.args[0]["params"]["code"], "ArrowUp")

    async def test_fullscreen_key_failure_still_releases_key(self):
        self.video_fullscreen.return_value = True
        self.socket.receive_json.side_effect = [{"id": 1, "error": {}}, {"id": 2}]
        with self.assertRaises(RuntimeError):
            await self.scroller.scroll("https://video.example/", 1, 0, 506, 500)
        self.assertEqual(self.socket.send_json.call_args.args[0]["params"]["type"], "keyUp")

    async def test_fullscreen_detection_requires_a_video_inside_native_or_web_fullscreen(self):
        for index, fullscreen in enumerate([True, False], 1):
            self.scroller._socket = self.socket
            self.socket.receive_json.return_value = {"id": index, "result": {"result": {"value": fullscreen}}}
            self.assertEqual(await WebScroller._video_fullscreen(self.scroller), fullscreen)
        expression = self.socket.send_json.call_args.args[0]["params"]["expression"]
        self.assertIn('document.fullscreenElement', expression)
        self.assertIn('data-screen="web"', expression)
        self.assertIn("root.querySelector('video')", expression)

    async def test_space_sends_one_keydown_and_one_keyup(self):
        self.socket.receive_json.side_effect = [{"id": 1}, {"id": 2}]
        await self.scroller.space("https://video.example/")
        calls = [call.args[0] for call in self.socket.send_json.call_args_list]
        self.assertEqual([c["method"] for c in calls], ["Input.dispatchKeyEvent"] * 2)
        self.assertEqual([c["params"]["type"] for c in calls], ["keyDown", "keyUp"])
        self.assertTrue(all(c["params"]["key"] == " " and c["params"]["code"] == "Space" for c in calls))

    async def test_space_attempts_keyup_even_if_keydown_is_rejected(self):
        self.socket.receive_json.side_effect = [{"id": 1, "error": {}}, {"id": 2}]
        with self.assertRaises(RuntimeError):
            await self.scroller.space("https://video.example/")
        self.assertEqual(self.socket.send_json.call_args_list[-1].args[0]["params"]["type"], "keyUp")

    async def test_fullscreen_sends_f_down_and_up_to_matching_web_page(self):
        self.socket.receive_json.side_effect = [{"id": 1}, {"id": 2}]
        await self.scroller.fullscreen("https://video.example/")
        calls = [call.args[0] for call in self.socket.send_json.call_args_list]
        self.connection.assert_awaited_once_with("https://video.example/", "")
        self.assertEqual([c["params"]["type"] for c in calls], ["keyDown", "keyUp"])
        self.assertTrue(all(c["params"]["key"] == "f" and c["params"]["code"] == "KeyF"
                            and c["params"]["windowsVirtualKeyCode"] == 70 for c in calls))

    async def test_media_actions_use_matching_page_and_report_script_errors(self):
        self.socket.receive_json.side_effect = [{"id": i, "result": {}} for i in range(1, 3)]
        for action in ["pause", "resume"]:
            await self.scroller.media("https://video.example/", action, "视频")
            request = self.socket.send_json.call_args.args[0]
            self.assertEqual(request["method"], "Runtime.evaluate")
            self.assertIn('const action = "' + action + '"', request["params"]["expression"])
            self.assertTrue(request["params"]["userGesture"])
            self.assertTrue(request["params"]["awaitPromise"])
        self.connection.assert_awaited_once_with("https://video.example/", "视频")
        self.socket.receive_json.side_effect = [{"id": 3, "result": {"exceptionDetails": {}}}]
        with self.assertRaises(RuntimeError):
            await self.scroller.media("https://video.example/", "pause", "视频")
        self.assertIsNone(self.scroller._socket)

    async def test_invalid_media_action_and_non_web_target_are_rejected(self):
        for url, action in [("https://video.example/", "bad action"),
                            ("https://video.example/", "enter"),
                            ("https://video.example/", "exit"),
                            ("file:///tmp/guide.JPG", "enter"),
                            ("https://steamloopback.host/", "pause")]:
            with self.assertRaises(ValueError):
                await self.scroller.media(url, action)
        self.connection.assert_not_called()

    async def test_fullscreen_releases_key_on_error_and_rejects_non_web_targets(self):
        self.socket.receive_json.side_effect = [{"id": 1, "error": {}}, {"id": 2}]
        with self.assertRaises(RuntimeError):
            await self.scroller.fullscreen("https://video.example/")
        self.assertEqual(self.socket.send_json.call_args_list[-1].args[0]["params"]["type"], "keyUp")
        for url in ["file:///tmp/guide.JPG", "https://steamloopback.host/"]:
            with self.assertRaises(ValueError):
                await self.scroller.fullscreen(url)

    async def test_invalid_inputs_cannot_target_steam_or_non_web_pages(self):
        for url, x, width in [("https://steamloopback.host/", 1, 506), ("file:///etc/passwd", 1, 506),
                              ("https://guide.example/", float("nan"), 506),
                              ("https://guide.example/", 1, 0)]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                await self.scroller.scroll(url, x, 0, width, 534)
        self.connection.assert_not_called()

    async def test_navigation_rebinds_and_close_releases_connection(self):
        await self.scroller.scroll("https://guide.example/one", 0, 1, 506, 534)
        self.socket.receive_json.return_value = {"id": 2}
        await self.scroller.scroll("https://guide.example/two", 0, 1, 506, 534)
        self.assertEqual(self.connection.await_count, 2)
        await self.scroller.close()
        self.assertIsNone(self.scroller._socket)
        self.assertIsNone(self.scroller._url)

    async def test_browser_errors_disconnect_and_allow_retry(self):
        self.socket.receive_json.return_value = {"id": 1, "error": {"message": "closed"}}
        with self.assertRaises(RuntimeError):
            await self.scroller.scroll("https://guide.example/", 0, 1, 506, 534)
        self.assertIsNone(self.scroller._socket)

    async def test_zoom_runs_only_on_matching_page_and_resets_native_pinch(self):
        self.socket.receive_json.side_effect = [
            {"id": 1, "result": {"result": {"value": {"factor": 0.833333}}}},
            {"id": 2, "result": {}},
        ]
        result = await self.scroller.zoom("https://guide.example/", "smaller")
        self.assertAlmostEqual(result["factor"], 0.833333)
        calls = [call.args[0] for call in self.socket.send_json.call_args_list]
        self.assertEqual(calls[0]["method"], "Runtime.evaluate")
        self.assertIn('const action = "smaller"', calls[0]["params"]["expression"])
        self.assertEqual(calls[1]["method"], "Emulation.setPageScaleFactor")
        self.assertEqual(calls[1]["params"], {"pageScaleFactor": 1})

    async def test_invalid_zoom_action_cannot_evaluate_script(self):
        with self.assertRaises(ValueError):
            await self.scroller.zoom("https://guide.example/", "script injection")
        self.connection.assert_not_called()

    async def test_script_exception_is_reported_and_disconnects(self):
        self.socket.receive_json.return_value = {"id": 1, "result": {"exceptionDetails": {}}}
        with self.assertRaises(RuntimeError):
            await self.scroller.zoom("https://guide.example/", "default")
        self.assertIsNone(self.scroller._socket)

    def test_query_rewrite_matches_only_a_unique_same_origin_path(self):
        original = "https://www.bilibili.com/video/BV123/?share=abc"
        rewritten = {"type": "page", "url": original + "&p=1"}
        unrelated = {"type": "page", "url": "https://other.example/video/BV123/?share=abc"}
        self.assertEqual(self.scroller._matching_pages([rewritten, unrelated], original), [rewritten])
        second = {"type": "page", "url": original + "&p=2"}
        self.assertEqual(len(self.scroller._matching_pages([rewritten, second], original)), 2)
        exact = {"type": "page", "url": original}
        self.assertEqual(self.scroller._matching_pages([exact, rewritten], original), [exact])

    async def test_episode_switch_uses_current_title_and_returns_actual_url(self):
        old = {"type": "page", "url": "https://video.example/episode/1", "title": "第一集"}
        new = {"type": "page", "url": "https://video.example/episode/2", "title": "第二集"}
        unrelated = {**new, "url": "https://other.example/episode/2"}
        self.socket.receive_json.return_value = {"id": 1, "result": {"result": {
            "value": {"url": new["url"], "title": "第二集"}}}}
        with patch.object(self.scroller, "_pages", AsyncMock(return_value=[old, new, unrelated])):
            page = await self.scroller.page_state(old["url"], "第二集")
        self.assertEqual(page, {"url": new["url"], "title": "第二集"})
        self.socket.receive_json.side_effect = [{"id": 2}, {"id": 3}]
        await self.scroller.space(old["url"], "第二集")
        self.connection.assert_awaited_once_with(old["url"], "第二集")

    async def test_snapshot_uses_actual_episode_heading_when_browser_title_is_stale(self):
        page = {"type": "page", "url": "https://www.bilibili.com/video/BV456/", "title": "第一集"}
        self.socket.receive_json.return_value = {"id": 1, "result": {"result": {
            "value": {"url": page["url"], "title": "第二集"}}}}
        with patch.object(self.scroller, "_pages", AsyncMock(return_value=[page])):
            state = await self.scroller.page_state("https://www.bilibili.com/video/BV123/", "第一集")
        self.assertEqual(state, {"url": page["url"], "title": "第二集"})
        expression = self.socket.send_json.call_args.args[0]["params"]["expression"]
        self.assertIn("h1.video-title", expression)
        self.assertIn("location.href", expression)

    async def test_title_fallback_rejects_duplicates_other_origins_and_old_title(self):
        original = "https://video.example/episode/1"
        page = {"type": "page", "url": "https://video.example/episode/2", "title": "第二集"}
        for pages in [[page, dict(page)], [{**page, "url": "https://other.example/episode/2"}],
                      [{**page, "title": "第一集"}]]:
            with patch.object(self.scroller, "_pages", AsyncMock(return_value=pages)):
                with self.subTest(pages=pages), self.assertRaises(ValueError):
                    await self.scroller.page_state(original, "第二集")

    async def test_current_title_change_rebinds_an_existing_input_connection(self):
        self.socket.receive_json.side_effect = [{"id": i} for i in range(1, 5)]
        await self.scroller.space("https://video.example/episode/1", "第一集")
        await self.scroller.space("https://video.example/episode/1", "第二集")
        self.assertEqual(self.connection.await_count, 2)
        self.connection.assert_awaited_with("https://video.example/episode/1", "第二集")
