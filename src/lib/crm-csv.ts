export function parseCrmCsv(content: string) {
  const input = content.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === "\"" && input[index + 1] === "\"") {
        currentCell += "\"";
        index++;
      } else if (character === "\"") {
        quoted = false;
      } else {
        currentCell += character;
      }
    } else if (character === "\"" && currentCell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      currentRow.push(currentCell);
      currentCell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index++;
      currentRow.push(currentCell);
      if (currentRow.some((cell) => cell.trim())) rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += character;
    }
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted value.");
  if (currentCell.length || currentRow.length) {
    currentRow.push(currentCell);
    if (currentRow.some((cell) => cell.trim())) rows.push(currentRow);
  }
  return rows;
}
