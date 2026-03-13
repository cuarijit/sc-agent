const expected = process.argv[2];

if (!expected) {
  console.error("Usage: node scripts/guard-platform.cjs <win32|darwin|linux>");
  process.exit(1);
}

if (process.platform !== expected) {
  console.error(
    [
      `Platform guard failed: expected '${expected}', current platform is '${process.platform}'.`,
      "This packaging command must be run on the target OS to bundle a compatible backend binary.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Platform guard passed: ${process.platform}`);
