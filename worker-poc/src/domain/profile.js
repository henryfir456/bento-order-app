export const VALID_PICKUP_FLOORS = Object.freeze(['1樓', '9樓']);

export const isProfileComplete = (user) => (
  typeof user?.displayName === 'string'
    && user.displayName.trim().length > 0
    && VALID_PICKUP_FLOORS.includes(user.pickupFloor)
);
