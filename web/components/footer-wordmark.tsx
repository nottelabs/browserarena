import styles from "./footer-wordmark.module.css";

export function FooterWordmark() {
  return (
    <footer className={styles.band} aria-label="Browserarena">
      <p className={styles.word} aria-hidden="true">Browserarena</p>
    </footer>
  );
}
