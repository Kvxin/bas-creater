export interface AudioResource {
  id: string;
  type: 'audio-file';
  name: string;
  url: string; // Blob URL
  file: File;
  duration?: number;
}
