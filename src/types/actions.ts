export type ActionResult<T = void> =
  | { success: true; data?: T; redirectTo?: string }
  | { success: false; error: string }
