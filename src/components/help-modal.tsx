import { ConfirmModal, Focusable } from '@decky/ui';
import type { ModalRootProps } from '@decky/ui';

export const HelpModal = (props: ModalRootProps) => (
  <ConfirmModal {...props} strTitle="使用说明" strOKButtonText="知道了" bAlertDialog>
    <Focusable
      flow-children="column"
      style={{ maxHeight: '55vh', overflowY: 'auto', fontSize: 16, lineHeight: 1.6 }}
    >
      <p>阅读快捷键仅在攻略或网页显示时生效。方向键上下查看说明。</p>
      {[
        ['L2', '切换最大窗口与侧栏大小，保持视频播放器自身的全屏状态。'],
        ['R2', '向网页发送空格，切换视频暂停／播放；需网站支持空格快捷键。'],
        [
          '「…」',
          '随快捷栏同步隐藏／显示。最大窗口自动暂停／继续，手动暂停的视频仍保持暂停；侧栏模式可开启「随侧栏播放/暂停」。',
        ],
        ['L1 / R1', '缩小／放大网页或本地图片。'],
        ['L3', '按下左摇杆，恢复默认缩放。'],
        [
          '右摇杆',
          '滚动攻略或网页。视频播放器全屏时，左右快退／快进，上下调高／调低音量，需网站支持方向键。',
        ],
        ['R3', '按下右摇杆。启用「按下右摇杆切换视频全屏」后向网页发送 F，需网站支持 F 快捷键。'],
        ['A / B', '插件界面中，A 选择，B 返回或关闭弹窗。'],
      ].map(([key, description]) => (
        <Focusable key={key} style={{ display: 'flex', gap: 12, padding: '8px 0' }}>
          <b style={{ flex: '0 0 80px' }}>{key}</b>
          <span>{description}</span>
        </Focusable>
      ))}
    </Focusable>
  </ConfirmModal>
);
