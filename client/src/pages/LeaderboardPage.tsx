import { useEffect } from 'react';
import { useLeaderboardStore } from '../hooks/useLeaderboard';
import { Leaderboard } from '../components/leaderboard/Leaderboard';
import { LeaderboardTabs } from '../components/leaderboard/LeaderboardTabs';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';

export function LeaderboardPage() {
  const { entries, period, total, page, pageSize, isLoading, fetchLeaderboard, setPeriod, nextPage, prevPage } = useLeaderboardStore();

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold font-display mb-2">
            <span className="text-accent-cyan">Leader</span>board
          </h1>
          <p className="text-text-secondary">
            Top traders ranked by return on investment
          </p>
        </div>

        {/* Period tabs */}
        <div className="mb-6">
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
              <div className="flex items-center justify-between mt-6">
                <Button
                  variant="secondary"
                  onClick={prevPage}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="text-text-secondary">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="secondary"
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
  );
}
