package com.etheller.warsmash.networking;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

import net.warsmash.networking.udp.OrderedUdpCommuncation;

public class WarsmashClientWriter {
	private static final int DIAGNOSTIC_CHUNK_BYTES = 900;
	private static int nextDiagnosticTransferId = 1;

	// Type widened from OrderedUdpClient (UDP-specific) to its abstract parent
	// so non-UDP transports — currently only WebRtcOrderedClient on the web
	// build — can plug in without subclassing OrderedUdpClient (which would
	// drag java.net.* into the TeaVM reachability graph).
	private final OrderedUdpCommuncation client;
	private final ByteBuffer sendBuffer = ByteBuffer.allocate(1024).order(ByteOrder.BIG_ENDIAN);
	private final long sessionToken;

	public WarsmashClientWriter(final OrderedUdpCommuncation client, final long sessionToken) {
		this.client = client;
		this.sessionToken = sessionToken;
	}

	public void issueTargetOrder(final int unitHandleId, final int abilityHandleId, final int orderId,
			final int targetHandleId, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ClientToServerProtocol.ISSUE_TARGET_ORDER);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putInt(targetHandleId);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	public void issuePointOrder(final int unitHandleId, final int abilityHandleId, final int orderId, final float x,
			final float y, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ClientToServerProtocol.ISSUE_POINT_ORDER);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putFloat(x);
		this.sendBuffer.putFloat(y);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	public void issueDropItemAtPointOrder(final int unitHandleId, final int abilityHandleId, final int orderId,
			final int targetHandleId, final float x, final float y, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4 + 4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ClientToServerProtocol.ISSUE_DROP_ITEM_ORDER);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putInt(targetHandleId);
		this.sendBuffer.putFloat(x);
		this.sendBuffer.putFloat(y);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	public void issueDropItemAtTargetOrder(final int unitHandleId, final int abilityHandleId, final int orderId,
			final int targetHandleId, final int targetHeroHandleId, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ClientToServerProtocol.ISSUE_DROP_ITEM_ON_TARGET_ORDER);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putInt(targetHandleId);
		this.sendBuffer.putInt(targetHeroHandleId);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	public void issueImmediateOrder(final int unitHandleId, final int abilityHandleId, final int orderId,
			final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ClientToServerProtocol.ISSUE_IMMEDIATE_ORDER);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	public void unitCancelTrainingItem(final int unitHandleId, final int cancelIndex) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4 + 4);
		this.sendBuffer.putInt(ClientToServerProtocol.UNIT_CANCEL_TRAINING);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(cancelIndex);
	}

	public void issueGuiPlayerEvent(final int eventId) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4);
		this.sendBuffer.putInt(ClientToServerProtocol.ISSUE_GUI_PLAYER_EVENT);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(eventId);
	}

	public void finishedTurn(final int gameTurnTick) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4);
		this.sendBuffer.putInt(ClientToServerProtocol.FINISHED_TURN);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(gameTurnTick);
	}

	public void framesSkipped(final int skippedCount) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4);
		this.sendBuffer.putInt(ClientToServerProtocol.FRAMES_SKIPPED);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(skippedCount);
	}

	/**
	 * Periodic state-hash report for desync detection.
	 * Wire payload: protocol(4) + sessionToken(8) + gameTurnTick(4) + stateHash(8).
	 */
	public void stateHash(final int gameTurnTick, final long stateHash) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8 + 4 + 8);
		this.sendBuffer.putInt(ClientToServerProtocol.STATE_HASH);
		this.sendBuffer.putLong(this.sessionToken);
		this.sendBuffer.putInt(gameTurnTick);
		this.sendBuffer.putLong(stateHash);
	}

	/**
	 * See {@link ClientToServerProtocol#DESYNC_DUMP}. This self-sends because
	 * large reports must be split into sub-MTU packets for the web transport.
	 */
	public void desyncDump(final int gameTurnTick, final String localDump) {
		final byte[] dumpBytes = localDump == null
				? new byte[0]
				: localDump.getBytes(java.nio.charset.StandardCharsets.UTF_8);
		final int transferId = nextDiagnosticTransferId++;
		for (int offset = 0; offset < dumpBytes.length; offset += DIAGNOSTIC_CHUNK_BYTES) {
			final int chunkLen = Math.min(DIAGNOSTIC_CHUNK_BYTES, dumpBytes.length - offset);
			this.sendDiagnosticDumpChunk(gameTurnTick, dumpBytes, transferId, offset, chunkLen);
		}
		if (dumpBytes.length == 0) {
			this.sendDiagnosticDumpChunk(gameTurnTick, dumpBytes, transferId, 0, 0);
		}
		this.sendBuffer.clear();
		this.sendBuffer.limit(0);
	}

	private void sendDiagnosticDumpChunk(final int gameTurnTick, final byte[] dumpBytes, final int transferId,
			final int offset, final int chunkLen) {
		final ByteBuffer buf = ByteBuffer.allocate(4 + 4 + 8 + 4 + 4 + 4 + 4 + 4 + chunkLen)
				.order(ByteOrder.BIG_ENDIAN);
		buf.putInt(4 + 8 + 4 + 4 + 4 + 4 + 4 + chunkLen);
		buf.putInt(ClientToServerProtocol.DESYNC_DUMP_CHUNK);
		buf.putLong(this.sessionToken);
		buf.putInt(gameTurnTick);
		buf.putInt(transferId);
		buf.putInt(dumpBytes.length);
		buf.putInt(offset);
		buf.putInt(chunkLen);
		buf.put(dumpBytes, offset, chunkLen);
		buf.flip();
		try {
			this.client.send(buf);
		}
		catch (final IOException e) {
			throw new RuntimeException(e);
		}
	}

	public void joinGame() {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 8);
		this.sendBuffer.putInt(ClientToServerProtocol.JOIN_GAME);
		this.sendBuffer.putLong(this.sessionToken);
	}

	public void send() {
		this.sendBuffer.flip();
		try {
			this.client.send(this.sendBuffer);
		}
		catch (final IOException e) {
			throw new RuntimeException(e);
		}
	}

}
