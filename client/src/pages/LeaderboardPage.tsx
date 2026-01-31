import { useEffect } from 'react';
import { useLeaderboardStore } from '../hooks/useLeaderboard';
import { Leaderboard } from '../components/leaderboard/Leaderboard';
import { LeaderboardTabs } from '../components/leaderboard/LeaderboardTabs';
import { MobileNav } from '../components/ui/MobileNav';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';

export function LeaderboardPage() {
  const { entries, period, total, page, pageSize, isLoading, fetchLeaderboard, setPeriod, nextPage, prevPage } = useLeaderboardStore();

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="h-full bg-[#0d0f11] pb-14 md:pb-0">
      <div className="h-full overflow-auto p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-4 md:mb-6">
            <h1 className="text-2xl font-bold text-white mb-1">
              Leaderboard
            </h1>
            <p className="text-gray-500 text-sm">
              Top traders ranked by ROI
            </p>
          </div>

          {/* Period tabs */}
          <div className="mb-4">
            <LeaderboardTabs
              activePeriod={period}
              onPeriodChange={setPeriod}
            />
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
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={prevPage}
                    disabled={page === 1}
                  >
                    Prev
                  </Button>
                  <span className="text-gray-500 text-sm">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={nextPage}
                    disabled={page >= totalPages}
                  >
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
