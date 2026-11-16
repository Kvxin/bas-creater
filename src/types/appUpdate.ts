export type AppUpdateStatus = {
  currentVersion: string;
  supported: boolean;
  availableVersion: string | null;
  notes: string | null;
  ready: boolean;
};

export type UpdateProgress = { downloaded: number; total: number | null };
