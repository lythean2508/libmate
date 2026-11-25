import React from 'react';

export const LoadingState: React.FC<{ message?: string }> = ({
  message = 'Đang tải dữ liệu thư viện...',
}) => (
  <div className="card" role="status" style={{ textAlign: 'center', padding: '2rem' }}>
    <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>{message}</div>
    <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
      Vui lòng chờ trong giây lát.
    </div>
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
    <h3 style={{ margin: '0 0 0.4rem', fontSize: '1.08rem' }}>{title}</h3>
    {description && (
      <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        {description}
      </p>
    )}
    {action}
  </div>
);

export const ErrorState: React.FC<{
  message: string;
  onRetry?: () => void;
}> = ({ message, onRetry }) => (
  <div className="alert alert-error" role="alert">
    <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Đã xảy ra lỗi</div>
    <div>{message}</div>
    {onRetry && (
      <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: '0.6rem' }} onClick={onRetry}>
        Thử lại
      </button>
    )}
  </div>
);

export const AvailabilityBadge: React.FC<{ available: number; total: number }> = ({
  available,
  total,
}) => {
  if (available > 0) {
    return (
      <span className="badge badge-success">
        Còn {available}/{total} bản sẵn có
      </span>
    );
  }
  return <span className="badge badge-danger">Hết bản sẵn có (0/{total})</span>;
};
