import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConfirmModalProps } from '@decky/ui';
import { NativeDialog } from './native-dialog';

vi.mock('@decky/ui', () => ({
  ConfirmModal: ({ onOK, onCancel, closeModal }: ConfirmModalProps) => (
    <div>
      <button
        onClick={() => {
          onOK?.();
          closeModal?.();
        }}
      >
        OK
      </button>
      <button
        onClick={() => {
          onCancel?.();
          closeModal?.();
        }}
      >
        B
      </button>
    </div>
  ),
}));

describe('controlled native dialog', () => {
  it('keeps async or nested actions open until the caller closes', () => {
    const ok = vi.fn(),
      cancel = vi.fn(),
      close = vi.fn();
    render(<NativeDialog onOK={ok} onCancel={cancel} closeModal={close} />);
    fireEvent.click(screen.getByText('OK'));
    fireEvent.click(screen.getByText('B'));
    expect(ok).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('blocks confirm and B while busy, then closes on cancel without a custom handler', () => {
    const close = vi.fn();
    const { rerender } = render(<NativeDialog bOKDisabled bCancelDisabled closeModal={close} />);
    fireEvent.click(screen.getByText('OK'));
    fireEvent.click(screen.getByText('B'));
    expect(close).not.toHaveBeenCalled();
    rerender(<NativeDialog closeModal={close} />);
    fireEvent.click(screen.getByText('B'));
    expect(close).toHaveBeenCalledOnce();
  });
});
