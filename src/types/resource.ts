export interface AudioResource {
  id: string;
  type: 'audio-file';
  name: string;
  url: string; // Blob URL
  coverUrl?: string; // 内嵌封面的 Data URL
  file: File;
  duration?: number;
}
