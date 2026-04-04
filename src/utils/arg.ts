export function getArg(name: string, fallback?: string) {
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (!token.startsWith("--")) continue;

    if (token.startsWith(`--${name}=`)) {
      const value = token.slice(name.length + 3);
      return value !== "" ? value : fallback;
    }

    if (token === `--${name}`) {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) return next;
      return fallback;
    }
  }

  return fallback;
}
