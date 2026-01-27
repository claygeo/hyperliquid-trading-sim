import { useState } from 'react';
import { ParticipantRow } from './ParticipantRow';
import { UI_CONSTANTS } from '../../config/constants';
import type { Participant } from '../../types/trading';
import { Spinner } from '../ui/Spinner';

interface ParticipantsTableProps {
  participants: Participant[];
  isLoading?: boolean;
}

export function ParticipantsTable({ participants, isLoading }: ParticipantsTableProps) {
  const [showAll, setShowAll] = useState(false);

  const displayedParticipants = showAll
    ? participants
    : participants.slice(0, UI_CONSTANTS.PARTICIPANTS_DEFAULT_VISIBLE);

  if (isLoading) {
    return (
      <div className="bg-bg-secondary rounded-xl border border-border p-4 flex items-center justify-center h-48">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-xl border border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">
          Market Participants ({participants.length})
        </h3>
        {participants.length > UI_CONSTANTS.PARTICIPANTS_DEFAULT_VISIBLE && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-accent-cyan hover:underline"
          >
            {showAll ? 'Show Less' : `Show All (${participants.length})`}
          </button>
        )}
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-9 gap-2 px-4 py-2 text-xs text-text-muted border-b border-border">
        <span>Trader</span>
        <span>Asset</span>
        <span>Side</span>
        <span className="text-right">Size</span>
        <span className="text-right">Entry</span>
        <span className="text-right">Current</span>
        <span className="text-right">PnL</span>
        <span className="text-right">Liq. Price</span>
        <span className="text-right">Margin</span>
      </div>

      {/* Participants list */}
      <div className={`${showAll ? 'max-h-96' : 'max-h-64'} overflow-y-auto`}>
        {displayedParticipants.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            No participants to display
          </div>
        ) : (
          displayedParticipants.map((participant) => (
            <ParticipantRow key={participant.id} participant={participant} />
          ))
        )}
      </div>
    </div>
  );
}
