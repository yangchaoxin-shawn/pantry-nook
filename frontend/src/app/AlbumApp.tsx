import { useEffect, useState } from 'react';
import JournalPage from '../features/journal/JournalPage';
import { Icon } from '../shared/ui/Primitives';
import '../App.css';
import '../styles/journal.css';
import './album.css';

/** 厨房相册外壳：只保留相册本身；库存、菜单等旧模块代码和数据原样保留，入口不再展示。 */
export default function AlbumApp() {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  return <div className="app album-app">
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className="header album-header">
      <span className="brand">
        <span className="brand-mark"><Icon name="bowl" size={23} /></span>
        <span>食隅记<small>OUR KITCHEN ALBUM</small></span>
      </span>
      <button className="theme-toggle" onClick={() => setDark(value => !value)} aria-label={dark ? '切换亮色主题' : '切换暗色主题'}>
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
    </header>
    <main id="main" className="main">
      <JournalPage active />
      <footer className="footer"><Icon name="bowl" size={16} />一隅烟火，三餐日常。<span>食隅记</span></footer>
    </main>
  </div>;
}
