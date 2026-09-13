/* 原创厨房线稿。只负责视觉，数量与表单状态由原型管理。 */
(() => {
  const person = '<circle cx="46" cy="37" r="10"/><path d="m40 48-4 30 19 1-5-29M37 77l-7 21-13 1m36-21 11 20 12 1"/>';
  const scenes = {
    pantry: `<path class="art-ground" d="M13 111q76 4 158-2"/><g class="art-person">${person}<path class="art-gesture" d="m43 54 28 8 6-14m-27 12 18 12 18-10"/></g><path d="m86 47 58 2 4 55-65 2zM102 49c-6-26 25-28 27 1" fill="var(--art-fill)"/><path d="m113 33-4-22m2 9-9-8m10 10 11-10M154 38l5-7m-2 15 10-3"/><path d="m97 73 10 11 21-23"/>`,
    recipe: `<path class="art-ground" d="M14 109q87 5 159-1"/><path d="M65 29q-25-12-48-3l-1 72q28-8 52 4 24-12 48-4l3-72q-27-8-54 3l3 73" fill="var(--art-fill)"/><path d="m28 41 23 2m-24 10 26 1m-26 12 17 1m34-24 28-2m-28 16 24-3m-21 13 19-2"/><g class="art-person" transform="translate(106 8) scale(.65)">${person}<path class="art-gesture" d="m41 53-21-7-5-21m34 30 21 11 8-14"/></g>`,
    pot: `<path class="art-ground" d="M12 110q84 3 165-1"/><g class="art-person">${person}<path class="art-gesture" d="m42 53 29 10 26 15m-50-18 19 14 33 6m-28-49 29 52"/></g><path d="M79 78c3 39 65 40 73 0Zm-6-2q44-6 85 0M76 85l-10-1m93 0h9" fill="var(--art-fill)"/><g class="art-steam"><path d="M112 65c-17-15 12-15 0-30m22 32c-16-15 12-16 2-29"/></g>`,
    empty: `<path class="art-ground" d="M12 110h158"/><path d="m81 76 56-2 23 15-65 4zM81 76v30l14 4 1-17m64-4v15l-65 6" fill="var(--art-fill)"/><g class="art-person">${person}<path class="art-gesture" d="m41 52 25 13 21 5m-39-11 12 13 26 7"/></g><path d="M112 54q-9-13 2-18 15-7 15 5 0 8-11 9v6m0 7v1"/>`,
    error: `<path class="art-ground" d="M14 110h164"/><path d="m108 48 40-1 5 57-47 1zM117 92l23-1" fill="var(--art-fill)"/><g class="art-person">${person}<path class="art-gesture" d="m42 52 25 14 30-12m-49 6 21 17 31-15"/></g><path d="m106 19 6 7m16-12v8m20-3-5 9m-25 46 18-1"/>`,
    loading: `<path class="art-ground" d="M13 110h161"/><g class="art-person">${person}<path class="art-gesture" d="m42 54 27 8 9 11m-29-13 15 12 19 2"/></g><path d="m96 44 48-1m-48 53 48 1m-42-51c0 22 18 24 18 24s18 1 18 25m0-49c0 20-18 24-18 24s-18 4-18 25"/><path d="m112 52 19-1-10 12z" fill="var(--art-fill)"/>`,
    celebrate: `<path class="art-ground" d="M13 110h164"/><path d="M19 74c5 36 53 37 57 0m-61-1 65-1" fill="var(--art-fill)"/><g class="art-person" transform="translate(68 0)">${person}<path class="art-gesture" d="m42 52-21-21-2-15m31 38 20-23 2-15M16 5c-8 7 0 16 6 10s2-12-6-10m54-4v13m5-13v12m5-11v11l-9 3"/></g><path d="m158 52 3 5 6 2-6 2-3 6-1-6-7-2 7-2z"/>`,
    plate: `<ellipse cx="91" cy="92" rx="65" ry="17"/><ellipse cx="91" cy="92" rx="47" ry="10"/><path d="M48 86c3-50 78-50 85 0m-88-1h90m-52-43 13-1m-6-1v-8" fill="var(--art-fill)"/><g class="art-steam"><path d="M164 79c-8-13 8-15 0-24"/></g>`,
    leaf: `<path d="M49 108c-9-50 16-77 92-84 8 69-35 100-92 84Zm0 0 67-66m-49 49V65m18 8 28 2" fill="var(--art-fill)"/>`,
  };
  window.PantryArt = { render(name = 'pot', extra = '') {
    return `<svg class="nook-art ${extra}" viewBox="0 0 190 125" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${scenes[name] || scenes.pot}</svg>`;
  }};
})();
