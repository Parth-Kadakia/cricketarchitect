export default function Panel({ title, actions, children, className = '' }) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel-header">
          <h3>{title}</h3>
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
