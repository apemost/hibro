/** Validates a release-it target against Chrome and Edge manifest version rules. */

const version = process.argv[2] ?? '';
const components = version.split('.');
const isValid =
  components.length >= 1 &&
  components.length <= 4 &&
  components.every(
    (component) =>
      /^(0|[1-9]\d*)$/.test(component) && Number(component) <= 65535,
  ) &&
  components.some((component) => Number(component) !== 0);

if (!isValid) {
  console.error(
    `Version "${version}" is not a valid Chrome/Edge extension version. ` +
      'Use one to four dot-separated integers from 0 to 65535, without leading zeros, and do not use an all-zero version.',
  );
  process.exitCode = 1;
}
