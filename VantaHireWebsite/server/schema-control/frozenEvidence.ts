export const FLOW_SCHEMA_FROZEN_EVIDENCE = Object.freeze({
  deployedSourceSha: "926c1d56eb965265a480b911e390164886386cc7",
  sourceCatalogSha256: "6c80a60c9364543e1b01b20d339bd5fe4a49d2c5354c5d107fb6349643916546",
  baselineSha256: "3fd883d6fb45d0c52acc69bff16949185948bb51e5d732f57247f542814aa129",
  catalogLockSha256: "999636b7722cc305b10f71b9a096cc75701400ff49aea91435f839cadf13b90c",
  semanticRecordCount: 1519,
  semanticRecordsSha256: "7b3bcc3ec74fed1c282e3d0519d7312a645fb139575208534dbd3303bc3762f1",
});

export function assertFrozenValue(label: string, actual: string, expected: string): void {
  if (actual.trim() !== expected) {
    throw new Error(`${label} does not match the independently verified frozen value.`);
  }
}
