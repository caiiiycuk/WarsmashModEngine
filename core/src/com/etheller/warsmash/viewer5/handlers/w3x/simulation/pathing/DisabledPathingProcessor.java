package com.etheller.warsmash.viewer5.handlers.w3x.simulation.pathing;

import com.etheller.warsmash.viewer5.handlers.w3x.environment.PathingGrid;
import com.etheller.warsmash.viewer5.handlers.w3x.simulation.CSimulation;
import com.etheller.warsmash.viewer5.handlers.w3x.simulation.CUnit;
import com.etheller.warsmash.viewer5.handlers.w3x.simulation.behaviors.CBehaviorMove;

// tdauth: Use to avoid "OutOfMemoryError: Java heap space" in CPathfindingProcessor.java:46
public class DisabledPathingProcessor implements PathingProcessor {

    @Override
    public void findNaiveSlowPath(final CUnit ignoreIntersectionsWithThisUnit,
            final CUnit ignoreIntersectionsWithThisSecondUnit, final float startX, final float startY,
            final PathingPoint goal, final PathingGrid.MovementType movementType, final float collisionSize,
            final boolean allowSmoothing, final CBehaviorMove queueItem) {
    }

    @Override
    public void removeFromPathfindingQueue(CBehaviorMove behaviorMove) {}

    @Override
    public void update(CSimulation simulation) {}
}
