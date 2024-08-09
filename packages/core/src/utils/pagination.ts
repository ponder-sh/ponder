export type Pagination = {
  updateAndPredict(from: string, to: string, result: unknown[]): string;
};

export const createPagination = ({
  limit,
  max,
}: { limit: number; max: string }): Pagination => {
  let density: number | undefined;

  return {
    updateAndPredict(from, to, result) {
      if (result.length === 0) return max;

      density = Number(BigInt(to) - BigInt(from)) / result.length;

      const estimate = BigInt(to) + BigInt(density * limit);

      return estimate > BigInt(max) ? max : estimate.toString();
    },
  };
};
