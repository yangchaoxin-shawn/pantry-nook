import { lazy, Suspense } from 'react';
import AlbumApp from './AlbumApp';

// 旧的库存与菜单模块暂停使用：代码和数据都保留，带 ?kitchen 参数仍可打开。
const KitchenApp = lazy(() => import('./App'));

export default function Root() {
  const kitchen = new URLSearchParams(window.location.search).has('kitchen');
  return kitchen ? <Suspense fallback={null}><KitchenApp /></Suspense> : <AlbumApp />;
}
