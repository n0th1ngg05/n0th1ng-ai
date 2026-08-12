export function cosineSimilarity(
    a: number[],
    b: number[]
): number {

    if (a.length !== b.length) {
        return 0;
    }

    let dot = 0;

    let magnitudeA = 0;

    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {

        dot += a[i] * b[i];

        magnitudeA += a[i] * a[i];

        magnitudeB += b[i] * b[i];

    }

    magnitudeA = Math.sqrt(magnitudeA);

    magnitudeB = Math.sqrt(magnitudeB);

    if (
        magnitudeA === 0 ||
        magnitudeB === 0
    ) {
        return 0;
    }

    return dot / (magnitudeA * magnitudeB);

}