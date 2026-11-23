const HOUR = 3600000;
const DAY = 24 * HOUR;
const clamp = value => Math.max(0, Math.min(1, value));
export const SCORE_BATCH_LIMIT = 100;

export function scoreTarget(target, now) {
    const sampleCount = Number(target?.mug_report_count) || 0;
    const average = Number(target?.mug_value_average);
    const last = Number(target?.last_mugged_at);
    const age = last > 0 && last <= now ? now - last : null;
    const result = {
        score:null, confidence:'unknown', sample_count:sampleCount, reason_codes:[]
    };
    if (age !== null) result.last_mugged_at = last;
    if (sampleCount < 1 || !Number.isFinite(average) || average < 0) return result;
    const low = clamp(Number(target.low_value_ratio) || 0);
    const payout = clamp(Math.log1p(average / 300000) / Math.log1p(3000000 / 300000));
    const consistency = 1 - low;
    const recovery = age === null ? 0.5 : clamp(age / (12 * HOUR));
    const minutesSinceTick = ((now % DAY) / 60000 - (18 * 60 + 5) + 1440) % 1440;
    const wages = Number(target.company_id) > 0 ? clamp(1 - minutesSinceTick / 60) : 0;
    const history = 60 * payout * (0.5 + 0.5 * consistency) + 20 * consistency;
    const opportunity = history * (0.75 + 0.25 * recovery) + 15 * payout * recovery + 5 * wages;
    // A single reported payout cannot establish a repeatable opportunity.
    result.score = Math.round(Math.min(sampleCount === 1 ? 59 : 100, opportunity));
    result.confidence = sampleCount >= 5 && age !== null && age < 30 * DAY ? 'moderate' : 'low';
    if (average >= 300000 && sampleCount >= 3 && low < 0.5) result.reason_codes.push('historically_profitable');
    if (sampleCount >= 3 && low >= 0.6) result.reason_codes.push('repeated_low_payouts');
    if (age !== null) result.reason_codes.push(age >= 12 * HOUR ? 'protection_window_elapsed' :
        age >= 11 * HOUR ? 'protection_mostly_expired' : 'recent_mug_observed');
    if (wages > 0) result.reason_codes.push('possible_company_wages');
    if (result.confidence === 'low') result.reason_codes.push('limited_evidence');
    return result;
}
