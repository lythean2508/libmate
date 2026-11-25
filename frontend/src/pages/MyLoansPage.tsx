import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/StateViews';
import { useAuth } from '../context/AuthContext';
import { MAX_ACTIVE_LOANS, libraryStore } from '../services/libraryStore';
import type { BorrowRequestView, LoanView } from '../types/library';
import { formatDateVi } from '../utils/vietnamese';

export const MyLoansPage: React.FC = () => {
  const { token, user, refreshUserAlerts } = useAuth();
  const [activeLoans, setActiveLoans] = useState<LoanView[]>([]);
  const [loanHistory, setLoanHistory] = useState<LoanView[]>([]);
  const [requests, setRequests] = useState<BorrowRequestView[]>([]);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadMyData = useCallback(() => {
    if (!token) return;
    const data = libraryStore.getMyActivity(token);
    setActiveLoans(data.activeLoans);
    setLoanHistory(data.loanHistory);
    setRequests(data.requests);
  }, [token]);

  useEffect(() => {
    loadMyData();
  }, [loadMyData]);

  const handleCancelRequest = (requestId: string) => {
    setNotice(null);
    try {
      libraryStore.cancelBorrowRequest(token, requestId);
      loadMyData();
      refreshUserAlerts();
      setNotice({ type: 'success', text: `Đã hủy yêu cầu mượn ${requestId}.` });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể hủy yêu cầu.',
      });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Sách đang mượn, Yêu cầu &amp; Lịch sử cá nhân</h1>
          <p className="page-subtitle">
            Tài khoản: <strong>{user?.name}</strong> ({user?.reader_code}) • Đang mượn:{' '}
            <strong>
              {activeLoans.length}/{MAX_ACTIVE_LOANS}
            </strong>{' '}
            cuốn tối đa.
          </p>
        </div>
      </div>

      {notice && (
        <div className={`alert ${notice.type === 'success' ? 'alert-success' : 'alert-error'}`} role="alert">
          {notice.text}
        </div>
      )}

      {/* 1. Sách đang mượn & nhãn quá hạn (T19 / TC16) */}
      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.12rem' }}>
          1. Sách đang mượn ({activeLoans.length})
        </h2>
        {activeLoans.length === 0 ? (
          <EmptyState
            title="Bạn hiện chưa có cuốn sách nào đang mượn"
            action={
              <Link to="/" className="btn btn-primary btn-sm">
                Khám phá danh mục sách
              </Link>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Đầu sách</th>
                  <th>Mã bản sao</th>
                  <th>Ngày mượn</th>
                  <th>Hạn trả</th>
                  <th>Tình trạng hạn</th>
                </tr>
              </thead>
              <tbody>
                {activeLoans.map((loan) => (
                  <tr key={loan.id}>
                    <td>
                      <code>{loan.id}</code>
                    </td>
                    <td>
                      <Link to={`/books/${loan.book_id}`}>
                        <strong>{loan.book_title}</strong>
                      </Link>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{loan.book_author}</div>
                    </td>
                    <td>
                      <code>{loan.copy_code}</code>
                    </td>
                    <td>{formatDateVi(loan.issued_at)}</td>
                    <td>
                      <strong>{formatDateVi(loan.due_at)}</strong>
                    </td>
                    <td>
                      {loan.is_overdue ? (
                        <span className="badge badge-danger">
                          Quá hạn {Math.abs(loan.days_remaining)} ngày
                        </span>
                      ) : loan.days_remaining <= 3 ? (
                        <span className="badge badge-warning">
                          {loan.days_remaining === 0
                            ? 'Đến hạn hôm nay'
                            : `Còn ${loan.days_remaining} ngày`}
                        </span>
                      ) : (
                        <span className="badge badge-success">Còn {loan.days_remaining} ngày</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 2. Yêu cầu mượn của tôi (T13 / TC10) */}
      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.12rem' }}>
          2. Yêu cầu đặt mượn theo đầu sách ({requests.length})
        </h2>
        {requests.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Chưa có yêu cầu đặt mượn nào.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã yêu cầu</th>
                  <th>Đầu sách</th>
                  <th>Kệ</th>
                  <th>Ngày gửi</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <code>{req.id}</code>
                    </td>
                    <td>
                      <Link to={`/books/${req.book_id}`}>{req.book_title}</Link>
                    </td>
                    <td>{req.book_shelf}</td>
                    <td>{formatDateVi(req.created_at)}</td>
                    <td>
                      {req.status === 'pending' && <span className="badge badge-warning">Đang chờ tại quầy</span>}
                      {req.status === 'fulfilled' && <span className="badge badge-success">Đã giao sách</span>}
                      {req.status === 'rejected' && (
                        <div>
                          <span className="badge badge-danger">Từ chối</span>
                          {req.rejection_reason && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--danger)', marginTop: '0.2rem' }}>
                              Lý do: {req.rejection_reason}
                            </div>
                          )}
                        </div>
                      )}
                      {req.status === 'cancelled' && <span className="badge badge-neutral">Đã hủy</span>}
                    </td>
                    <td>
                      {req.status === 'pending' ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => handleCancelRequest(req.id)}
                        >
                          Hủy yêu cầu
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. Lịch sử đã trả */}
      <section className="card">
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.12rem' }}>
          3. Lịch sử sách đã trả ({loanHistory.length})
        </h2>
        {loanHistory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Chưa có lịch sử trả sách.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mã phiếu</th>
                  <th>Đầu sách</th>
                  <th>Mã bản sao</th>
                  <th>Ngày mượn</th>
                  <th>Hạn trả</th>
                  <th>Ngày trả thực tế</th>
                </tr>
              </thead>
              <tbody>
                {loanHistory.map((loan) => (
                  <tr key={loan.id}>
                    <td>
                      <code>{loan.id}</code>
                    </td>
                    <td>{loan.book_title}</td>
                    <td>
                      <code>{loan.copy_code}</code>
                    </td>
                    <td>{formatDateVi(loan.issued_at)}</td>
                    <td>{formatDateVi(loan.due_at)}</td>
                    <td>{formatDateVi(loan.returned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
