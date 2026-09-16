import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';
import { mediaUrl, type JournalEntry } from './api';

export function openJournalGallery(entry: JournalEntry, index = 0) {
  const lightbox = new PhotoSwipeLightbox({
    dataSource: entry.photos.map(photo => ({ src: mediaUrl(photo.image.preview_url), width: photo.image.preview_width, height: photo.image.preview_height, alt: `${entry.entry_date} 的饭桌照片` })),
    pswpModule: () => import('photoswipe'), bgOpacity: 0.96, padding: { top: 70, bottom: 115, left: 14, right: 14 },
    closeTitle: '关闭照片', zoomTitle: '缩放', arrowPrevTitle: '上一张', arrowNextTitle: '下一张', errorMsg: '照片暂时无法读取，请关闭后重试。',
  });
  let video: HTMLVideoElement | undefined;
  let tools: HTMLDivElement | undefined;
  let playButton: HTMLButtonElement | undefined;
  let muteButton: HTMLButtonElement | undefined;
  let status: HTMLSpanElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hold: { x: number; y: number; playing: boolean } | undefined;
  let playbackRevision = 0;
  const pointers = new Set<number>();
  const current = () => entry.photos[lightbox.pswp?.currIndex ?? index];
  function stop() {
    playbackRevision++;
    if (video) { video.pause(); video.hidden = true; video.currentTime = 0; }
    if (playButton) { playButton.textContent = '◎ 播放实况'; playButton.setAttribute('aria-pressed', 'false'); }
    if (status && current().live_status === 'live') status.textContent = '长按照片可播放，松手回到封面';
  }
  function endHold() { clearTimeout(timer); if (hold?.playing) stop(); hold = undefined; }
  async function play() {
    const photo = current();
    if (!video || !photo.video_url) return;
    const revision = ++playbackRevision;
    video.hidden = false;
    if (playButton) { playButton.textContent = 'Ⅱ 停止实况'; playButton.setAttribute('aria-pressed', 'true'); }
    try { await video.play(); if (revision === playbackRevision && status) status.textContent = '实况播放中'; }
    catch { if (revision === playbackRevision) { stop(); if (status) status.textContent = '动态暂时无法播放，照片与原件仍可查看。'; } }
  }
  function update() {
    endHold(); stop();
    if (!tools || !video) return;
    tools.replaceChildren();
    const photo = current();
    const downloads = document.createElement('span'); downloads.className = 'journal-viewer-downloads';
    const original = document.createElement('a'); original.href = mediaUrl(photo.image.original_url); original.download = photo.image.original_name; original.textContent = '下载原片'; downloads.append(original);
    if (photo.motion) { const motion = document.createElement('a'); motion.href = mediaUrl(photo.motion.original_url); motion.download = photo.motion.original_name; motion.textContent = '下载原始动态'; downloads.append(motion); }
    tools.append(downloads);
    if (photo.video_url && photo.live_status === 'live') {
      video.src = mediaUrl(photo.video_url); video.poster = mediaUrl(photo.image.preview_url); video.muted = true;
      playButton = document.createElement('button'); playButton.type = 'button'; playButton.textContent = '◎ 播放实况'; playButton.setAttribute('aria-pressed', 'false'); playButton.onclick = () => { if (video?.paused) void play(); else stop(); };
      muteButton = document.createElement('button'); muteButton.type = 'button'; muteButton.textContent = '声音关'; muteButton.setAttribute('aria-pressed', 'false'); muteButton.onclick = () => { if (video) { video.muted = !video.muted; muteButton!.textContent = video.muted ? '声音关' : '声音开'; muteButton!.setAttribute('aria-pressed', String(!video.muted)); } };
      tools.append(playButton, muteButton);
    } else { video.removeAttribute('src'); video.load(); }
    status = document.createElement('span'); status.className = 'journal-viewer-status'; status.setAttribute('role', 'status');
    status.textContent = photo.live_status === 'live' ? '长按照片可播放，松手回到封面' : photo.live_status === 'missing_video' ? '缺少动态片段 · 当前保留静态原片' : '浏览预览图 · 原文件完整保留'; tools.append(status);
  }
  const pointerDown = (event: PointerEvent) => {
    pointers.add(event.pointerId);
    if (pointers.size > 1) { endHold(); return; }
    if (event.button !== 0 || !(event.target instanceof HTMLImageElement) || !current().video_url) return;
    hold = { x: event.clientX, y: event.clientY, playing: false };
    timer = setTimeout(() => { if (hold) { hold.playing = true; void play(); } }, 350);
  };
  const pointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); endHold(); };
  const contextMenu = (event: MouseEvent) => { if (current().video_url && event.target instanceof HTMLImageElement) event.preventDefault(); };
  const pointerMove = (event: PointerEvent) => { if (hold && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) endHold(); };
  lightbox.on('uiRegister', () => {
    lightbox.pswp?.ui?.registerElement({ name: 'journal-controls', order: 9, appendTo: 'root', onInit: element => {
      tools = document.createElement('div'); tools.className = 'journal-viewer-controls'; element.append(tools);
      video = document.createElement('video'); video.className = 'journal-viewer-video'; video.playsInline = true; video.muted = true; video.preload = 'metadata'; video.hidden = true;
      video.onended = stop; video.onerror = () => { stop(); if (status) status.textContent = '动态暂时无法播放，可以下载原始文件。'; };
      lightbox.pswp?.element?.append(video);
    } });
  });
  lightbox.on('afterInit', () => {
    update(); const element = lightbox.pswp?.element;
    element?.addEventListener('pointerdown', pointerDown); element?.addEventListener('pointermove', pointerMove); element?.addEventListener('contextmenu', contextMenu);
    window.addEventListener('pointerup', pointerUp); window.addEventListener('pointercancel', pointerUp);
  });
  lightbox.on('change', update);
  lightbox.on('close', () => { endHold(); stop(); });
  lightbox.on('destroy', () => { video?.remove(); window.removeEventListener('pointerup', pointerUp); window.removeEventListener('pointercancel', pointerUp); });
  lightbox.init(); lightbox.loadAndOpen(index);
  return () => lightbox.destroy();
}
