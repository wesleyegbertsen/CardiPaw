import type { Pet } from '../types';

export const DEFAULT_NORMAL_CEILING = 30;
export const DEFAULT_ELEVATED_CEILING = 35;

export interface RateStatus {
  label: string;    // 'Normal' | 'Elevated' | 'High'
  cssClass: string; // 'normal' | 'warning' | 'danger'
  color: string;    // hex — for PDF use only; UI uses cssClass + CSS variables
}

export function getRateStatus(
  rate: number,
  pet?: Pick<Pet, 'normalCeiling' | 'elevatedCeiling'>
): RateStatus {
  const normal   = pet?.normalCeiling   ?? DEFAULT_NORMAL_CEILING;
  const elevated = pet?.elevatedCeiling ?? DEFAULT_ELEVATED_CEILING;
  if (rate <= normal)   return { label: 'Normal',   cssClass: 'normal',  color: '#16a34a' };
  if (rate <= elevated) return { label: 'Elevated', cssClass: 'warning', color: '#d97706' };
  return                       { label: 'High',     cssClass: 'danger',  color: '#dc2626' };
}
