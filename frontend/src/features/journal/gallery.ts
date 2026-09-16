import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';
import { coverFirst } from './draft';
import { mediaUrl, type JournalEntry } from './api';

export function openJournalGallery(entry: JournalEntry, index = 0) {
  const photos = coverFirst(entry);
  const lightbox = new PhotoSwipeLightbox({
    dataSource: photos.map(photo => ({ src: mediaUrl(photo.image.preview_url), width: photo.image.preview_width, height: photo.image.preview_height, alt: `${entry.entry_date} 的饭桌照片` })),
    pswpModule: () => import('photoswipe'), bgOpacity: 0.96, padding: { top: 70, bottom: 115, left: 14, right: 14 },
    closeTitle: '关闭照片', zoomTitle: '缩放', arrowPrevTitle: '上一张', arrowNextTitle: '下一张', errorMsg: '照片暂时无法读取，请关闭后重试。',
  });
  let tools: HTMLDivElement | undefined;
  function update() {
    if (!tools) return;
    tools.replaceChildren();
    const photo = photos[lightbox.pswp?.currIndex ?? index];
    const downloads = document.createElement('span'); downloads.className = 'journal-viewer-downloads';
    const original = document.createElement('a'); original.href = mediaUrl(photo.image.original_url); original.download = photo.image.original_name; original.textContent = '下载原片'; downloads.append(original);
    const status = document.createElement('span'); status.className = 'journal-viewer-status'; status.textContent = '浏览预览图 · 原文件完整保留';
    tools.append(downloads, status);
  }
  lightbox.on('uiRegister', () => {
    lightbox.pswp?.ui?.registerElement({ name: 'journal-controls', order: 9, appendTo: 'root', onInit: element => {
      tools = document.createElement('div'); tools.className = 'journal-viewer-controls'; element.append(tools);
    } });
  });
  lightbox.on('afterInit', update);
  lightbox.on('change', update);
  lightbox.init(); lightbox.loadAndOpen(index);
  return () => lightbox.destroy();
}
