// 安装绕过普通窗口关闭事件，因此需要显式等待编辑器保存完毕。
let prepare: (() => Promise<boolean>) | undefined;

export const registerUpdatePreparation = (handler: () => Promise<boolean>): (() => void) => {
  prepare = handler;
  return () => {
    if (prepare === handler) prepare = undefined;
  };
};

export const prepareForAppUpdate = async (): Promise<boolean> => (prepare ? prepare() : true);
