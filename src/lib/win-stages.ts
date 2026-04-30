// src/lib/win-stages.ts
import type { WinStage } from '@/types/database';

export const REQUIRED_SELECTION_COUNT_BY_STAGE: Record<WinStage, number> = {
  Line: 5,
  'Two Lines': 10,
  'Full House': 15,
};

export function getRequiredSelectionCountForStage(stage: string): number | null {
  return Object.prototype.hasOwnProperty.call(REQUIRED_SELECTION_COUNT_BY_STAGE, stage)
    ? REQUIRED_SELECTION_COUNT_BY_STAGE[stage as WinStage]
    : null;
}
