import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../components/StateViews';
import { useAuth } from '../context/AuthContext';
import { MAX_ACTIVE_LOANS, libraryStore } from '../services/libraryStore';
import type { BookCopy, BorrowRequestView, LoanView } from '../types/library';
import { formatDateVi, normalizeSearchText } from '../utils/vietnamese';

export const LibrarianDeskPage: React.FC = () => {
  const { token, refreshUserAlerts } = useAuth();

  const [tab, setTab] = useState<'issue' | 'return'>('issue');
  const [pendingRequests, setPendingRequests] = useState<BorrowRequestView[]>([]);
  const [activeLoans, setActiveLoans] = useState<LoanView[]>([]);
  const [availableCopiesByBook, setAvailableCopiesByBook] = useState<Record<string, BookCopy[]>>({});

  const [selectedCopyByReq, setSelectedCopyByReq] = useState<Record<string, string>>({});
  const [rejectReasonByReq, setRejectReasonByReq] = useState<Record<string, string>>({});
  const [rejectingReqId, setRejectingReqId] = useState<string | null>(null);

  const [loanFilter, setLoanFilter] = useState('');
  const [maintenanceByLoan, setMaintenanceByLoan] = useState<Record<string, boolean>>({});
  const [noteByLoan, setNoteByLoan] = useState<Record<string, string>>({});

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadDesk = useCallback(() => {
    if (!token) return;
    const data = libraryStore.getLibrarianDeskData(token);
    setPendingRequests(data.pendingRequests);
    setActiveLoans(data.activeLoans);
    setAvailableCopiesByBook(data.availableCopiesByBook);

    const defaults: Record<string, string> = {};
    for (const req of data.pendingRequests) {
      const avail = data.availableCopiesByBook[req.book_id] ?? [];
      if (avail.length > 0) {
        defaults[req.id] = avail[0].id;
      }
    }
    setSelectedCopyByReq((prev) => ({ ...defaults, ...prev }));
  }, [token]);

  useEffect(() => {
    loadDesk();
  }, [loadDesk]);

  const handleIssue = (req: BorrowRequestView) => {
    const copyId = selectedCopyByReq[req.id];
    setFeedback(null);
    try {
      const issued = libraryStore.issueBookAtDesk(token, {
        requestId: req.id,
        copyId,
      });
      loadDesk();
      refreshUserAlerts();
      setFeedback({
        type: 'success',
        text: `Đã giao bản sao ${issued.copy_code} cho bạn đọc ${issued.reader_name} (${issued.reader_code}). Hạn trả: ${formatDateVi(issued.due_at)}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi khi giao sách.',
      });
      loadDesk();
    }
  };

  const handleReject = (requestId: string) => {
    const reason = rejectReasonByReq[requestId] ?? '';
    setFeedback(null);
    try {
      libraryStore.rejectBorrowRequest(token, { requestId, reason });
      setRejectingReqId(null);
      loadDesk();
      setFeedback({
        type: 'success',
        text: `Đã từ chối yêu cầu ${requestId} kèm lý do thông báo cho người đọc.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể từ chối yêu cầu.',
      });
    }
  };

  const handleReturn = (loan: LoanView) => {
    setFeedback(null);
    try {
      const markMaint = Boolean(maintenanceByLoan[loan.id]);
      const note = noteByLoan[loan.id] ?? '';
      const updated = libraryStore.returnLoanAtDesk(token, {
        loanId: loan.id,
        markMaintenance: markMaint,
        conditionNote: note,
      });
      loadDesk();
      refreshUserAlerts();
      setFeedback({
        type: 'success',
        text: `Đã xác nhận trả phiếu ${updated.id} (bản sao ${updated.copy_code} chuyển sang trạng thái: ${
          markMaint ? 'Bảo trì — tạm ngưng cho mượn' : 'Sẵn có trên kệ'
        }).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể xác nhận trả sách.',
      });
    }
  };

  const filteredActiveLoans = useMemo(() => {
    const q = normalizeSearchText(loanFilter);
    if (!q) return activeLoans;
    return activeLoans.filter((l) =>
      normalizeSearchText(`${l.id} ${l.copy_code} ${l.book_title} ${l.reader_code} ${l.reader_name}`).includes(q)
    );
  }, [activeLoans, loanFilter]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Quầy Thủ thư: Giao sách &amp; Xác nhận trả (`F07`, `F08`)</h1>
          <p className="page-subtitle">
            Chọn bản sao vật lý tại quầy khi giao, kiểm tra giới hạn mượn đồng thời và ghi nhận tình trạng sách khi trả.
          </p>
        </div>
      </div>

      {feedback && (
        <div className={`alert ${feedback.type === 'success' ? 'alert-success' : 'alert-error'}`} role="alert">
          {feedback.text}
        </div>
      )}

      <div className="tabs">
        <button
          type="button"
          className={`tab-btn ${tab === 'issue' ? 'active' : ''}`}
          onClick={() => {
            setTab('issue');
            setFeedback(null);
          }}
        >
          1. Yêu cầu chờ giao sách ({pendingRequests.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === 'return' ? 'active' : ''}`}
          onClick={() => {
            setTab('return');
            setFeedback(null);
          }}
        >
          2. Đang mượn &amp; Nhận trả sách ({activeLoans.length})
        </button>
      </div>

      {tab === 'issue' ? (
        <div className="card">
          {pendingRequests.length === 0 ? (
            <EmptyState
              title="Không có yêu cầu mượn nào đang chờ"
              description="Mọi yêu cầu đặt mượn từ người đọc đã được xử lý."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã YC</th>
                    <th>Người đọc (Đang mượn)</th>
                    <th>Đầu sách &amp; Kệ</th>
                    <th>Chọn bản sao vật lý (`copy_code`)</th>
                    <th>Thao tác tại quầy</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingRequests.map((req) => {
                    const copies = availableCopiesByBook[req.book_id] ?? [];
                    const atLimit = req.reader_active_loans >= MAX_ACTIVE_LOANS;
                    return (
                      <tr key={req.id}>
                        <td>
                          <code>{req.id}</code>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {formatDateVi(req.created_at)}
                          </div>
                        </td>
                        <td>
                          <strong>{req.reader_name}</strong> ({req.reader_code})
                          <div>
                            <span className={`badge ${atLimit ? 'badge-danger' : 'badge-info'}`}>
                              Đang mượn: {req.reader_active_loans}/{MAX_ACTIVE_LOANS}
                            </span>
                          </div>
                        </td>
                        <td>
                          <strong>{req.book_title}</strong>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            Kệ {req.book_shelf} • Sẵn có: {copies.length} bản
                          </div>
                        </td>
                        <td>
                          {copies.length > 0 ? (
                            <select
                              aria-label={`Chọn bản sao cho ${req.id}`}
                              className="select"
                              value={selectedCopyByReq[req.id] ?? copies[0].id}
                              onChange={(e) =>
                                setSelectedCopyByReq((prev) => ({ ...prev, [req.id]: e.target.value }))
                              }
                            >
                              {copies.map((cp) => (
                                <option key={cp.id} value={cp.id}>
                                  {cp.copy_code} (Sẵn có)
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="badge badge-danger">Không còn bản sẵn có</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={copies.length === 0 || atLimit}
                              onClick={() => handleIssue(req)}
                            >
                              Xác nhận giao
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm"
                              onClick={() =>
                                setRejectingReqId((cur) => (cur === req.id ? null : req.id))
                              }
                            >
                              Từ chối
                            </button>
                          </div>

                          {rejectingReqId === req.id && (
                            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                              <input
                                className="input"
                                style={{ minWidth: '190px' }}
                                placeholder="Nhập lý do từ chối..."
                                value={rejectReasonByReq[req.id] ?? ''}
                                onChange={(e) =>
                                  setRejectReasonByReq((prev) => ({
                                    ...prev,
                                    [req.id]: e.target.value,
                                  }))
                                }
                              />
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => handleReject(req.id)}
                              >
                                Gửi từ chối
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="field" style={{ maxWidth: '460px', marginBottom: '1rem' }}>
            <label htmlFor="loanSearchInput">
              Tìm nhanh phiếu đang mượn (theo mã bản sao, mã/tên bạn đọc hoặc tên sách)
            </label>
            <input
              id="loanSearchInput"
              className="input"
              value={loanFilter}
              onChange={(e) => setLoanFilter(e.target.value)}
              placeholder="VD: VHVN-001-A, HS10A1, Mắt Biếc..."
            />
          </div>

          {filteredActiveLoans.length === 0 ? (
            <EmptyState title="Không tìm thấy phiếu đang mượn nào khớp bộ lọc" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mã phiếu / Bản sao</th>
                    <th>Bạn đọc</th>
                    <th>Đầu sách</th>
                    <th>Hạn trả</th>
                    <th>Kiểm tra hư hỏng / Bảo trì (`T20`)</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActiveLoans.map((loan) => (
                    <tr key={loan.id}>
                      <td>
                        <code>{loan.id}</code>
                        <div>
                          Bản sao: <strong>{loan.copy_code}</strong>
                        </div>
                      </td>
                      <td>
                        <strong>{loan.reader_name}</strong>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {loan.reader_code}
                        </div>
                      </td>
                      <td>{loan.book_title}</td>
                      <td>
                        <div>{formatDateVi(loan.due_at)}</div>
                        {loan.is_overdue ? (
                          <span className="badge badge-danger">
                            Quá hạn {Math.abs(loan.days_remaining)} ngày
                          </span>
                        ) : (
                          <span className="badge badge-success">Đúng hạn</span>
                        )}
                      </td>
                      <td>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', marginBottom: '0.35rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={Boolean(maintenanceByLoan[loan.id])}
                            onChange={(e) =>
                              setMaintenanceByLoan((prev) => ({
                                ...prev,
                                [loan.id]: e.target.checked,
                              }))
                            }
                          />
                          Cần bảo trì (hư hỏng / rách)
                        </label>
                        <input
                          className="input"
                          placeholder="Ghi chú tình trạng khi trả..."
                          value={noteByLoan[loan.id] ?? ''}
                          onChange={(e) =>
                            setNoteByLoan((prev) => ({ ...prev, [loan.id]: e.target.value }))
                          }
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-success btn-sm"
                          onClick={() => handleReturn(loan)}
                        >
                          Xác nhận trả sách
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
