import { useEffect } from 'react';
import { useLeaderboardStore } from '../hooks/useLeaderboard';
import { Leaderboard } from '../components/leaderboard/Leaderboard';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { MobileNav } from '../components/ui/MobileNav';

export function LeaderboardPage() {
  const { entries, total, page, pageSize, isLoading, fetchLeaderboard, nextPage, prevPage } = useLeaderboardStore();

  useEffect(() => {
    fetchLeaderboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="h-full bg-[#0d0f11] pb-12 md:pb-0">
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-4">
            <div>
              <h1 className="text-xl font-semibold text-white">Leaderboard</h1>
              <p className="text-gray-500 text-xs mt-0.5">All-time paper-trading ROI</p>
            </div>
          </div>

          {/* Leaderboard */}
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : (
            <>
              <Leaderboard entries={entries} />

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 gap-2">
                  <Button variant="secondary" size="sm" onClick={prevPage} disabled={page === 1}>
                    Prev
                  </Button>
                  <span className="text-gray-500 text-sm font-mono">{page} / {totalPages}</span>
                  <Button variant="secondary" size="sm" onClick={nextPage} disabled={page >= totalPages}>
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <MobileNav />
    </div>
  );
}
