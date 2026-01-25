/** File: src/lib/server/logic/ownership.ts */
import type { NormalizedShareholder, DocumentProperties } from '$lib/types';

/**
 * Calculates 'ratio' for each shareholder deterministically.
 * Policy:
 * 1) DECLARED_RATIO: If raw ratio exists, use it.
 * 2) DERIVED_FROM_SHARES: (shares / ref_total_shares) * 100
 * 3) DERIVED_FROM_AMOUNT: (amount / ref_total_amount) * 100
 * 4) Else null
 */
export function calculateEffectiveRatios(
    shareholders: NormalizedShareholder[],
    props: DocumentProperties
): NormalizedShareholder[] {
    // Prepare Reference Totals
    const refTotalShares = getReferencedTotalShares(shareholders, props);
    const refTotalAmount = getReferencedTotalAmount(shareholders, props);

    return shareholders.map(s => {
        let effectiveRatio: number | null = null;

        // Strategy 1: Declared Ratio
        if (s.ratio !== null) {
            effectiveRatio = s.ratio;
        }
        // Strategy 2: Derive from Shares
        else if (s.shares !== null && refTotalShares !== null && refTotalShares > 0) {
            effectiveRatio = (s.shares / refTotalShares) * 100;
        }
        // Strategy 3: Derive from Amount
        else if (s.amount !== null && refTotalAmount !== null && refTotalAmount > 0) {
            effectiveRatio = (s.amount / refTotalAmount) * 100;
        }

        return {
            ...s,
            ratio: effectiveRatio
        };
    });
}

/**
 * S1: declared > 0
 * S2: no declared AND all shares present -> sum(shares)
 */
function getReferencedTotalShares(shareholders: NormalizedShareholder[], props: DocumentProperties): number | null {
    if (props.total_shares_issued && props.total_shares_issued > 0) {
        return props.total_shares_issued;
    }

    const allHaveShares = shareholders.every(s => s.shares !== null);
    if (allHaveShares && shareholders.length > 0) {
        return shareholders.reduce((acc, s) => acc + (s.shares || 0), 0);
    }

    return null;
}

/**
 * A1: declared > 0
 * A2: no declared AND all amounts present -> sum(amount)
 */
function getReferencedTotalAmount(shareholders: NormalizedShareholder[], props: DocumentProperties): number | null {
    if (props.total_capital && props.total_capital > 0) {
        return props.total_capital;
    }

    const allHaveAmounts = shareholders.every(s => s.amount !== null);
    if (allHaveAmounts && shareholders.length > 0) {
        return shareholders.reduce((acc, s) => acc + (s.amount || 0), 0);
    }

    return null;
}
