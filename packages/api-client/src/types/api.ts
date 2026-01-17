/**
 * Common API types.
 */

export interface ApiError {
  detail: string | Array<{ loc: string[]; msg: string }>;
}

export interface RequestOptions {
  /** Include auth token in request. Default: true */
  includeAuth?: boolean;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

export interface CachedRequestOptions extends RequestOptions {
  /** Cache TTL in milliseconds. */
  ttl?: number;
  /** Force refresh ignoring cache. */
  forceRefresh?: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}
