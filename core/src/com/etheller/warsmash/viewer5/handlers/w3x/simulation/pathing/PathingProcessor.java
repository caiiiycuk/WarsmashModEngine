package com.etheller.warsmash.viewer5.handlers.w3x.simulation.pathing;

import com.etheller.warsmash.viewer5.handlers.w3x.environment.PathingGrid;
import com.etheller.warsmash.viewer5.handlers.w3x.simulation.CSimulation;
import com.etheller.warsmash.viewer5.handlers.w3x.simulation.CUnit;
import com.etheller.warsmash.viewer5.handlers.w3x.simulation.behaviors.CBehaviorMove;

public interface PathingProcessor {

    void findNaiveSlowPath(final CUnit ignoreIntersectionsWithThisUnit,
                                  final CUnit ignoreIntersectionsWithThisSecondUnit, final float startX, final float startY,
                                  final PathingPoint goal, final PathingGrid.MovementType movementType, final float collisionSize,
                                  final boolean allowSmoothing, final CBehaviorMove queueItem);

    void removeFromPathfindingQueue(final CBehaviorMove behaviorMove);

    void update(final CSimulation simulation);
}
