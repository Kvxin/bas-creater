const zhCN = {
  title: "应用更新",
  currentVersion: "当前版本：{version}",
  available: "发现新版本 {version}",
  upToDate: "当前已是最新版本",
  autoDownload: "自动下载更新（安装前询问）",
  check: "检查更新",
  checking: "正在检查…",
  download: "下载更新",
  downloading: "正在下载并验证更新…",
  install: "保存工程并安装重启",
  installing: "正在保存工程并安装更新，请勿关闭应用…",
  ready: "更新已下载，点击安装后将保存工程并重启应用。",
  later: "稍后",
  manualOnly: "当前为便携版、开发版或非 AppImage 的 Linux 版本，请前往下载页手动更新。",
  webOnly: "Web 版随网站更新，桌面客户端可在下载页获取。",
  downloadPage: "前往下载页",
  checkFailed: "检查更新失败，请检查网络后重试。首次发布更新清单前暂时无法检查。",
  downloadFailed: "下载或验证更新失败，请重试。",
  installFailed: "安装更新失败，请重试或手动下载安装包。",
  saveFailed: "工程未能安全保存，已取消安装。请先处理编辑器中的保存错误。",
  errorDetails: "错误详情"
};

const en: typeof zhCN = {
  title: "App updates",
  currentVersion: "Current version: {version}",
  available: "Version {version} is available",
  upToDate: "You are up to date",
  autoDownload: "Download updates automatically (ask before installing)",
  check: "Check for updates",
  checking: "Checking…",
  download: "Download update",
  downloading: "Downloading and verifying update…",
  install: "Save project, install and restart",
  installing: "Saving your project and installing the update. Please keep the app open…",
  ready: "Update downloaded. Installing will save your project and restart the app.",
  later: "Later",
  manualOnly: "Portable, development and non-AppImage Linux builds require a manual update from the download page.",
  webOnly: "The web app updates with the website. Desktop builds are available on the download page.",
  downloadPage: "Open download page",
  checkFailed:
    "Could not check for updates. Check your connection and retry. The first update manifest must be published first.",
  downloadFailed: "Could not download or verify the update. Please retry.",
  installFailed: "Could not install the update. Retry or download an installer manually.",
  saveFailed: "The project could not be saved safely. Installation was cancelled. Resolve the editor save error first.",
  errorDetails: "Error details"
};

const ja: typeof zhCN = {
  title: "アプリの更新",
  currentVersion: "現在のバージョン：{version}",
  available: "新しいバージョン {version} があります",
  upToDate: "最新バージョンです",
  autoDownload: "更新を自動ダウンロード（インストール前に確認）",
  check: "更新を確認",
  checking: "確認中…",
  download: "更新をダウンロード",
  downloading: "更新をダウンロード・検証中…",
  install: "保存してインストール・再起動",
  installing: "保存して更新をインストール中です。アプリを閉じないでください…",
  ready: "更新をダウンロードしました。インストールすると保存して再起動します。",
  later: "後で",
  manualOnly: "ポータブル版・開発版・AppImage 以外の Linux 版はダウンロードページから手動で更新してください。",
  webOnly: "Web 版はサイトと共に更新されます。デスクトップ版はダウンロードページから入手できます。",
  downloadPage: "ダウンロードページを開く",
  checkFailed: "更新の確認に失敗しました。接続を確認して再試行してください。初回の更新情報の公開が必要です。",
  downloadFailed: "ダウンロードまたは検証に失敗しました。再試行してください。",
  installFailed: "更新のインストールに失敗しました。再試行するか手動でダウンロードしてください。",
  saveFailed: "安全に保存できなかったため、インストールを中止しました。先に保存エラーを解決してください。",
  errorDetails: "エラー詳細"
};

export default { "zh-CN": zhCN, en, ja };
