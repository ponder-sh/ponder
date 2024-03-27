// TODO(kyle) Not sure if this is actually the correct type
type EncodedRow = {
  [columnName: string]: string | number | bigint | Buffer | null;
};

/**
 * Returns true if the columns in the updated row are equal to the columns
 * in the previous row. This also means that if the updated row is empty,
 * it returns true. It is assumed that the column names and types are the same.
 */
export const isRowEqual = ({
  originalRow,
  updateRow,
}: { originalRow: EncodedRow; updateRow: EncodedRow }) => {
  for (const columnName of Object.keys(updateRow)) {
    if (Buffer.isBuffer(updateRow[columnName])) {
      if (
        (updateRow[columnName] as Buffer).equals(
          originalRow[columnName] as Buffer,
        ) === false
      ) {
        return false;
      }
    } else {
      if (updateRow[columnName] !== originalRow[columnName]) {
        return false;
      }
    }
  }
  return true;
};
