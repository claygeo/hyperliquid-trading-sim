import { useState } from 'react';
import { Button } from '../ui/Button';

interface FollowButtonProps {
  address: string;
  isFollowing?: boolean;
  onFollow: (address: string) => void;
  onUnfollow: (address: string) => void;
}

export function FollowButton({ address, isFollowing = false, onFollow, onUnfollow }: FollowButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      if (isFollowing) {
        await onUnfollow(address);
      } else {
        await onFollow(address);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant={isFollowing ? 'secondary' : 'primary'}
      size="sm"
      onClick={handleClick}
      isLoading={loading}
    >
      {isFollowing ? 'Unfollow' : 'Follow'}
    </Button>
  );
}
