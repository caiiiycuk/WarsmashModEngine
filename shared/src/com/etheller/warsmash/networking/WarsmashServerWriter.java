package com.etheller.warsmash.networking;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Set;

public class WarsmashServerWriter implements ServerToClientListener {
	private static final int DIAGNOSTIC_CHUNK_BYTES = 900;
	private static int nextDiagnosticTransferId = 1;

	// Type widened from OrderedUdpServer to MessageSender so non-UDP
	// transports can plug in (the web build's WebRtcOrderedServer uses a
	// custom marker class to identify peers by netlib peer id rather than
	// IP+port). Concrete OrderedUdpServer still satisfies this on desktop.
	// Address type is Object — see UdpServerListener for rationale.
	private final MessageSender server;
	private final ByteBuffer sendBuffer = ByteBuffer.allocate(1024).order(ByteOrder.BIG_ENDIAN);
	private final Set<Object> allKnownAddressesToSend;

	public WarsmashServerWriter(final MessageSender server, final Set<Object> allKnownAddressesToSend) {
		this.server = server;
		this.allKnownAddressesToSend = allKnownAddressesToSend;
	}

	@Override
	public void issueTargetOrder(final int playerIndex, final int unitHandleId, final int abilityHandleId,
			final int orderId, final int targetHandleId, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ServerToClientProtocol.ISSUE_TARGET_ORDER);
		this.sendBuffer.putInt(playerIndex);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putInt(targetHandleId);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	@Override
	public void issuePointOrder(final int playerIndex, final int unitHandleId, final int abilityHandleId,
			final int orderId, final float x, final float y, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ServerToClientProtocol.ISSUE_POINT_ORDER);
		this.sendBuffer.putInt(playerIndex);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putFloat(x);
		this.sendBuffer.putFloat(y);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	@Override
	public void issueDropItemAtPointOrder(final int playerIndex, final int unitHandleId, final int abilityHandleId,
			final int orderId, final int targetHandleId, final float x, final float y, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ServerToClientProtocol.ISSUE_DROP_ITEM_ORDER);
		this.sendBuffer.putInt(playerIndex);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putInt(targetHandleId);
		this.sendBuffer.putFloat(x);
		this.sendBuffer.putFloat(y);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	@Override
	public void issueDropItemAtTargetOrder(final int playerIndex, final int unitHandleId, final int abilityHandleId,
			final int orderId, final int targetHandleId, final int targetHeroHandleId, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ServerToClientProtocol.ISSUE_DROP_ITEM_ON_TARGET_ORDER);
		this.sendBuffer.putInt(playerIndex);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.putInt(targetHandleId);
		this.sendBuffer.putInt(targetHeroHandleId);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	@Override
	public void issueImmediateOrder(final int playerIndex, final int unitHandleId, final int abilityHandleId,
			final int orderId, final boolean queue) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4 + 4 + 4 + 1);
		this.sendBuffer.putInt(ServerToClientProtocol.ISSUE_IMMEDIATE_ORDER);
		this.sendBuffer.putInt(playerIndex);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(abilityHandleId);
		this.sendBuffer.putInt(orderId);
		this.sendBuffer.put(queue ? (byte) 1 : (byte) 0);
	}

	@Override
	public void unitCancelTrainingItem(final int playerIndex, final int unitHandleId, final int cancelIndex) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4 + 4);
		this.sendBuffer.putInt(ServerToClientProtocol.UNIT_CANCEL_TRAINING);
		this.sendBuffer.putInt(playerIndex);
		this.sendBuffer.putInt(unitHandleId);
		this.sendBuffer.putInt(cancelIndex);
	}

	@Override
	public void issueGuiPlayerEvent(final int playerIndex, final int eventId) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4);
		this.sendBuffer.putInt(ServerToClientProtocol.ISSUE_GUI_PLAYER_EVENT);
		this.sendBuffer.putInt(playerIndex);
		this.sendBuffer.putInt(eventId);
	}

	@Override
	public void finishedTurn(final int gameTurnTick) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4);
		this.sendBuffer.putInt(ServerToClientProtocol.FINISHED_TURN);
		this.sendBuffer.putInt(gameTurnTick);
	}

	@Override
	public void heartbeat() {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4);
		this.sendBuffer.putInt(ServerToClientProtocol.HEARTBEAT);
	}

	@Override
	public void acceptJoin(final int playerIndex) {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4);
		this.sendBuffer.putInt(ServerToClientProtocol.ACCEPT_JOIN);
		this.sendBuffer.putInt(playerIndex);
	}

	@Override
	public void combinedDesyncReport(final int gameTurnTick, final String combinedReport) {
		final byte[] reportBytes = combinedReport == null
				? new byte[0]
				: combinedReport.getBytes(java.nio.charset.StandardCharsets.UTF_8);
		final int transferId = nextDiagnosticTransferId++;
		for (int offset = 0; offset < reportBytes.length; offset += DIAGNOSTIC_CHUNK_BYTES) {
			final int chunkLen = Math.min(DIAGNOSTIC_CHUNK_BYTES, reportBytes.length - offset);
			this.sendCombinedReportChunk(gameTurnTick, reportBytes, transferId, offset, chunkLen);
		}
		if (reportBytes.length == 0) {
			this.sendCombinedReportChunk(gameTurnTick, reportBytes, transferId, 0, 0);
		}
		this.sendBuffer.clear();
		this.sendBuffer.limit(0);
	}

	private void sendCombinedReportChunk(final int gameTurnTick, final byte[] reportBytes, final int transferId,
			final int offset, final int chunkLen) {
		final ByteBuffer buf = ByteBuffer.allocate(4 + 4 + 4 + 4 + 4 + 4 + 4 + chunkLen)
				.order(ByteOrder.BIG_ENDIAN);
		buf.putInt(4 + 4 + 4 + 4 + 4 + 4 + chunkLen);
		buf.putInt(ServerToClientProtocol.COMBINED_DESYNC_REPORT_CHUNK);
		buf.putInt(gameTurnTick);
		buf.putInt(transferId);
		buf.putInt(reportBytes.length);
		buf.putInt(offset);
		buf.putInt(chunkLen);
		buf.put(reportBytes, offset, chunkLen);
		buf.flip();
		try {
			for (final Object address : this.allKnownAddressesToSend) {
				final int pos = buf.position();
				final int limit = buf.limit();
				this.server.send(address, buf);
				buf.position(pos);
				buf.limit(limit);
			}
		}
		catch (final IOException e) {
			throw new RuntimeException(e);
		}
	}

	@Override
	public void desyncDetected(final int gameTurnTick, final String peerHashSummary) {
		// Wire payload: protocol(4) + turnTick(4) + summaryLength(4) + summaryBytes(N).
		// Peer-hash summary is a human-readable multi-line string keyed by
		// peer id; clients display it verbatim in the diagnostic overlay
		// so the user can share it with us.
		final byte[] summaryBytes = peerHashSummary == null
				? new byte[0]
				: peerHashSummary.getBytes(java.nio.charset.StandardCharsets.UTF_8);
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4 + 4 + 4 + summaryBytes.length);
		this.sendBuffer.putInt(ServerToClientProtocol.DESYNC_DETECTED);
		this.sendBuffer.putInt(gameTurnTick);
		this.sendBuffer.putInt(summaryBytes.length);
		this.sendBuffer.put(summaryBytes);
	}

	@Override
	public void startGame() {
		this.sendBuffer.clear();
		this.sendBuffer.putInt(4);
		this.sendBuffer.putInt(ServerToClientProtocol.START_GAME);
	}

	public void send(final Object sourceAddress) {
		this.sendBuffer.flip();
		try {
			this.server.send(sourceAddress, this.sendBuffer);
		}
		catch (final IOException e) {
			throw new RuntimeException(e);
		}
	}

	public void send() {
		this.sendBuffer.flip();
		try {
			for (final Object address : this.allKnownAddressesToSend) {
				final int pos = this.sendBuffer.position();
				final int limit = this.sendBuffer.limit();
				this.server.send(address, this.sendBuffer);
				this.sendBuffer.position(pos);
				this.sendBuffer.limit(limit);
			}
		}
		catch (final IOException e) {
			throw new RuntimeException(e);
		}
	}

}
