import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { libraryStore } from '../services/libraryStore';
import { formatDateVi } from '../utils/vietnamese';

function triggerDownloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const LibrarianReportsPage: React.FC = () => {
  const { token } = useAuth();
  const [loanStatus, setLoanStatus] = useState<'ALL' | 'ACTIVE' | 'OVERDUE' | 'RETURNED'>('ALL');
  const [category, setCategory] = useState('ALL');
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const categories = useMemo(() => libraryStore.getCategories(), []);

  const report = useMemo(
    () => libraryStore.getLibrarianReport(token, { loanStatus, category }),
    [token, loanStatus, category]
  );

  const handleExportLoans = () => {
    const csv = libraryStore.exportLoansCsv(token, { loanStatus, category });
    triggerDownloadCsv(`libmate-phieu-muon-${loanStatus.toLowerCase()}.csv`, csv);
    setExportMsg('Đã xuất tệp CSV danh sách phiếu mượn (mã hóa UTF-8 BOM mở trực tiếp bằng Excel).');
  };

  const handleExportInventory = () => {
    const csv = libraryStore.exportInventoryCsv(token);
    triggerDownloadCsv('libmate-ton-kho-ban-sao.csv', csv);
    setExportMsg('Đã xuất tệp CSV tồn kho đầu sách & bản sao toàn trường.');
  };

  const { summary, loans, auditLogs } = report;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tổng quan Báo cáo Thủ thư &amp; Xuất CSV (`F09`, `T31`)</h1>
          <p className="page-subtitle">
            Số liệu tồn kho, đang mượn, bảo trì và quá hạn được đối chiếu trực tiếp từ dữ liệu bản sao và phiếu mượn (`TC17`).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleExportLoans}>
            ⬇ Xuất CSV Phiếu mượn
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleExportInventory}>
            ⬇ Xuất CSV Tồn kho
          </button>
        </div>
      </div>

      {exportMsg && <div className="alert alert-success">{exportMsg}</div>}

      <div className="grid-kpi">
        <div className="kpi-card">
          <div className="kpi-label">Đầu sách đang hiển thị</div>
          <div className="kpi-value">{summary.total_visible_books}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Tổng bản sao vật lý</div>
          <div className="kpi-value">{summary.total_copies}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Bản sao Sẵn có</div>
          <div className="kpi-value" style={{ color: 'var(--success)' }}>
            {summary.available_copies}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Bản sao Đang mượn</div>
          <div className="kpi-value" style={{ color: 'var(--primary)' }}>
            {summary.borrowed_copies}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Bản sao Bảo trì</div>
          <div className="kpi-value" style={{ color: 'var(--warning)' }}>
            {summary.maintenance_copies}
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Phiếu mượn Quá hạn</div>
          <div className="kpi-value" style={{ color: 'var(--danger)' }}>
            {summary.overdue_loans}
          </div>
        </div>
      </div>

      <section className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="form-grid" style={{ marginBottom: '1rem' }}>
          <div className="field">
            <label htmlFor="reportLoanStatus">Lọc theo trạng thái phiếu</label>
            <select
              id="reportLoanStatus"
              className="select"
              value={loanStatus}
              onChange={(e) =>
                setLoanStatus(e.target.value as 'ALL' | 'ACTIVE' | 'OVERDUE' | 'RETURNED')
              }
            >
              <option value="ALL">Tất cả phiếu mượn</option>
              <option value="ACTIVE">Đang mượn (chưa trả)</option>
              <option value="OVERDUE">Chỉ phiếu quá hạn</option>
              <option value="RETURNED">Đã trả hoàn tất</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="reportCategory">Lọc theo chủ đề sách</label>
            <select
              id="reportCategory"
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="ALL">Tất cả chủ đề</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã phiếu</th>
                <th>Bạn đọc</th>
                <th>Đầu sách</th>
                <th>Mã bản sao</th>
                <th>Ngày mượn</th>
                <th>Hạn trả</th>
                <th>Tình trạng</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td>
                    <code>{l.id}</code>
                  </td>
                  <td>
                    <strong>{l.reader_name}</strong> ({l.reader_code})
                  </td>
                  <td>{l.book_title}</td>
                  <td>
                    <code>{l.copy_code}</code>
                  </td>
                  <td>{formatDateVi(l.issued_at)}</td>
                  <td>{formatDateVi(l.due_at)}</td>
                  <td>
                    {l.returned_at ? (
                      <span className="badge badge-neutral">Đã trả ({formatDateVi(l.returned_at)})</span>
                    ) : l.is_overdue ? (
                      <span className="badge badge-danger">Quá hạn</span>
                    ) : (
                      <span className="badge badge-success">Đang mượn</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ margin: '0 0 0.75rem', fontSize: '1.08rem' }}>
          Nhật ký thao tác nghiệp vụ gần đây (`Audit Log` — `T24`)
        </h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Người thực hiện</th>
                <th>Hành động</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateVi(log.timestamp)}</td>
                  <td>{log.actor_name}</td>
                  <td>
                    <code>{log.action}</code>
                  </td>
                  <td>{log.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
