import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

export type RankingSortDirection = 'asc' | 'desc';

export interface RankingColumn<T> {
  id: string;
  label: string;
  className?: string;
  sortable?: boolean;
  value?: (item: T) => string | number | null | undefined;
  render: (item: T, index: number) => ReactNode;
}

interface RankingTableProps<T> {
  caption: string;
  columns: RankingColumn<T>[];
  items: T[];
  rowKey: (item: T) => string;
  sort: { column: string; direction: RankingSortDirection };
  onSortChange?: (sort: { column: string; direction: RankingSortDirection }) => void;
  onRowClick?: (item: T, trigger: HTMLButtonElement) => void;
  rowClassName?: (item: T, index: number) => string;
  emptyTitle?: string;
  emptyMessage?: string;
  rankOffset?: number;
  serverSorted?: boolean;
}

function compareValues(left: string | number, right: string | number) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'pt-BR', { numeric: true, sensitivity: 'base' });
}

export function RankingTable<T>({
  caption,
  columns,
  items,
  rowKey,
  sort,
  onSortChange,
  onRowClick,
  rowClassName,
  emptyTitle = 'Nenhum resultado',
  emptyMessage = 'Ajuste os filtros ou aguarde novas estatísticas.',
  rankOffset = 0,
  serverSorted = false,
}: RankingTableProps<T>) {
  const activeColumn = columns.find((column) => column.id === sort.column && column.sortable && column.value);
  const sorted = activeColumn && !serverSorted
    ? [...items].sort((left, right) => {
      const leftValue = activeColumn.value?.(left);
      const rightValue = activeColumn.value?.(right);
      if (leftValue == null && rightValue == null) return 0;
      if (leftValue == null) return 1;
      if (rightValue == null) return -1;
      const result = compareValues(leftValue, rightValue);
      return sort.direction === 'asc' ? result : -result;
    })
    : items;

  function changeSort(column: RankingColumn<T>) {
    if (!onSortChange || !column.sortable || !column.value) return;
    onSortChange({
      column: column.id,
      direction: sort.column === column.id && sort.direction === 'desc' ? 'asc' : 'desc',
    });
  }

  return (
    <div className="rankings-table-wrap">
      <table className="rankings-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.id} className={column.className} scope="col" aria-sort={sort.column === column.id ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                {onSortChange && column.sortable && column.value ? (
                  <button type="button" onClick={() => changeSort(column)}>
                    {column.label}
                    {sort.column === column.id
                      ? sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      : <ChevronsUpDown size={12} />}
                  </button>
                ) : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item, index) => (
            <tr key={rowKey(item)} className={rowClassName?.(item, index)}>
              {columns.map((column, columnIndex) => (
                <td key={column.id} className={column.className}>
                  {columnIndex === 0 && onRowClick ? (
                    <button type="button" className="rankings-table__primary-action" onClick={(event) => onRowClick(item, event.currentTarget)}>
                      {column.render(item, index + rankOffset)}
                    </button>
                  ) : column.render(item, index + rankOffset)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!sorted.length && (
        <div className="rankings-empty-state" role="status">
          <strong>{emptyTitle}</strong>
          <span>{emptyMessage}</span>
        </div>
      )}
    </div>
  );
}
