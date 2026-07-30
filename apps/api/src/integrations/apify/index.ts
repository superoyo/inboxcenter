// จุดเข้าเดียวของ integration Apify — คง shape เดิมที่ server.js เรียกไว้ (fetchPagePosts/hasToken/addDays)
export { hasToken, callApify, ApifyTokenMissingError, DEFAULT_TIMEOUT_MS } from './client';
export { fetchPagePosts, addDays } from './facebook-posts';
export type { FetchPagePostsOptions } from './facebook-posts';
export { normalizePost, firstImage, errorFromRows } from './normalize';
export type { NormalizedPost } from './normalize';
