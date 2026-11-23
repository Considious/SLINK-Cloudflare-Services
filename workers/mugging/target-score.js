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
    const hasPayout = sampleCount > 0 && target?.mug_value_average != null && Number.isFinite(average) && average >= 0;
    const employer = Number(target?.company_id) > 0;
    const companyTier = employer ? clamp(Number(target.company_rating) / 10 || 0) : 0;
    const recentMugs = Array.isArray(target?.recent_mugs) ? target.recent_mugs : null;
    const mugCount = days => recentMugs ? recentMugs.filter(at => at >= now - days * DAY && at <= now).length :
        age !== null && age <= days * DAY ? Number(target['mug_count_' + days + 'd']) || 0 : 0;
    const frequency = clamp((mugCount(7) * 2 + mugCount(30)) / 15);
    const recovery = age === null ? 0.5 : clamp(age / (12 * HOUR));
    const minutesSinceTick = ((now % DAY) / 60000 - (18 * 60 + 5) + 1440) % 1440;
    const wages = employer ? clamp(1 - minutesSinceTick / 60) * (0.5 + 0.5 * companyTier) : 0;
    if (!hasPayout && age === null && !frequency && !companyTier && !wages) return result;
    if (!hasPayout) {
        // Observed activity supports a tentative opportunity estimate, with no assumed payout.
        result.score = Math.round(18 + 20 * frequency * (0.5 + 0.5 * recovery) +
            (age === null ? 0 : 10 * recovery) + 4 * companyTier + 5 * wages);
        result.confidence = 'low';
        result.reason_codes.push('no_recorded_payouts');
    }
    const low = clamp(Number(target?.low_value_ratio) || 0);
    const payout = clamp(Math.log1p(average / 300000) / Math.log1p(3000000 / 300000));
    const consistency = 1 - low;
    const history = 60 * payout * (0.5 + 0.5 * consistency) + 20 * consistency;
    const opportunity = history * (0.75 + 0.25 * recovery) + 12 * payout * recovery + 3 * frequency + 5 * wages;
    // A single reported payout cannot establish a repeatable opportunity.
    if (hasPayout) {
        result.score = Math.round(Math.min(sampleCount === 1 ? 59 : 100, opportunity));
        result.confidence = sampleCount >= 5 && age !== null && age < 30 * DAY ? 'moderate' : 'low';
    }
    if (frequency > 0) result.reason_codes.push('observed_mug_frequency');
    if (companyTier > 0 && !hasPayout) result.reason_codes.push('company_tier_signal');
    if (hasPayout && average >= 300000 && sampleCount >= 3 && low < 0.5) result.reason_codes.push('historically_profitable');
    if (hasPayout && sampleCount >= 3 && low >= 0.6) result.reason_codes.push('repeated_low_payouts');
    if (age !== null) result.reason_codes.push(age >= 12 * HOUR ? 'protection_window_elapsed' :
        age >= 11 * HOUR ? 'protection_mostly_expired' : 'recent_mug_observed');
    if (wages > 0) result.reason_codes.push('possible_company_wages');
    if (result.confidence === 'low') result.reason_codes.push('limited_evidence');
    return result;
}
