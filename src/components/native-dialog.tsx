import { ConfirmModal } from '@decky/ui';
import type { ConfirmModalProps } from '@decky/ui';

// Steam normally closes a ConfirmModal after OK/Cancel. Keep this dialog
// controlled so failed async opens and nested delete/folder screens stay open.
export const NativeDialog = ({ closeModal, onOK, onCancel, ...props }: ConfirmModalProps) => (
  <ConfirmModal
    {...props}
    closeModal={() => undefined}
    onOK={() => {
      if (!props.bOKDisabled) (onOK || closeModal)?.();
    }}
    onCancel={() => {
      if (!props.bCancelDisabled) (onCancel || closeModal)?.();
    }}
  />
);
