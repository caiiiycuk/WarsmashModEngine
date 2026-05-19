package com.etheller.warsmash.networking;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import net.warsmash.networking.udp.OrderedUdpClientListener;

public class WarsmashClientParser implements OrderedUdpClientListener {
	private static final int MAX_DIAGNOSTIC_BYTES = 1024 * 1024;

	private ServerToClientListener listener;
	private final Map<DiagnosticChunkKey, DiagnosticChunkAssembly> combinedReportChunks = new HashMap<>();

	public WarsmashClientParser(final ServerToClientListener listener) {
		this.listener = listener;
	}

	/**
	 * No-arg constructor for callers that need to break the construction
	 * cycle between {@link WarsmashClient}, this parser, and the underlying
	 * transport ({@code OrderedUdpClient} on desktop,
	 * {@code WebRtcOrderedClient} on web). Use {@link #setListener} once the
	 * {@link WarsmashClient} is constructed.
	 */
	public WarsmashClientParser() {
	}

	/**
	 * Late-binds the listener. Pairs with the no-arg constructor; ignored if
	 * a listener was already set via the legacy constructor.
	 */
	public void setListener(final ServerToClientListener listener) {
		this.listener = listener;
	}

	@Override
	public void cantReplay(final int seqNo) {
		throw new IllegalStateException("Cant replay seqNo=" + seqNo + " !");
	}

	@Override
	public void parse(final ByteBuffer buffer) {
		final int initialLimit = buffer.limit();
		try {
			while (buffer.hasRemaining()) {
				final int length = buffer.getInt();
				if (length > buffer.remaining()) {
					// this packet is junk to us, so we will skip and continue (drop system will
					// handle it)
					System.err.println("Got mismatched protocol length " + length + " > " + buffer.remaining() + "!!");
				}
				final int protocol = buffer.getInt();
				switch (protocol) {
				case ServerToClientProtocol.ISSUE_TARGET_ORDER: {
					final int playerIndex = buffer.getInt();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final int targetHandleId = buffer.getInt();
					final boolean queue = buffer.get() == 1;
					this.listener.issueTargetOrder(playerIndex, unitHandleId, abilityHandleId, orderId, targetHandleId,
							queue);
					break;
				}
				case ServerToClientProtocol.ISSUE_POINT_ORDER: {
					final int playerIndex = buffer.getInt();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final float x = buffer.getFloat();
					final float y = buffer.getFloat();
					final boolean queue = buffer.get() == 1;
					this.listener.issuePointOrder(playerIndex, unitHandleId, abilityHandleId, orderId, x, y, queue);
					break;
				}
				case ServerToClientProtocol.ISSUE_DROP_ITEM_ORDER: {
					final int playerIndex = buffer.getInt();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final int targetHandleId = buffer.getInt();
					final float x = buffer.getFloat();
					final float y = buffer.getFloat();
					final boolean queue = buffer.get() == 1;
					this.listener.issueDropItemAtPointOrder(playerIndex, unitHandleId, abilityHandleId, orderId,
							targetHandleId, x, y, queue);
					break;
				}
				case ServerToClientProtocol.ISSUE_DROP_ITEM_ON_TARGET_ORDER: {
					final int playerIndex = buffer.getInt();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final int targetHandleId = buffer.getInt();
					final int targetHeroHandleId = buffer.getInt();
					final boolean queue = buffer.get() == 1;
					this.listener.issueDropItemAtTargetOrder(playerIndex, unitHandleId, abilityHandleId, orderId,
							targetHandleId, targetHeroHandleId, queue);
					break;
				}
				case ServerToClientProtocol.ISSUE_IMMEDIATE_ORDER: {
					final int playerIndex = buffer.getInt();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final boolean queue = buffer.get() == 1;
					this.listener.issueImmediateOrder(playerIndex, unitHandleId, abilityHandleId, orderId, queue);
					break;
				}
				case ServerToClientProtocol.UNIT_CANCEL_TRAINING: {
					final int playerIndex = buffer.getInt();
					final int unitHandleId = buffer.getInt();
					final int cancelIndex = buffer.getInt();
					this.listener.unitCancelTrainingItem(playerIndex, unitHandleId, cancelIndex);
					break;
				}
				case ServerToClientProtocol.ISSUE_GUI_PLAYER_EVENT: {
					final int playerIndex = buffer.getInt();
					final int eventId = buffer.getInt();
					this.listener.issueGuiPlayerEvent(playerIndex, eventId);
					break;
				}
				case ServerToClientProtocol.FINISHED_TURN: {
					final int gameTurnTick = buffer.getInt();
					this.listener.finishedTurn(gameTurnTick);
					break;
				}
				case ServerToClientProtocol.ACCEPT_JOIN: {
					final int playerIndex = buffer.getInt();
					this.listener.acceptJoin(playerIndex);
					break;
				}
				case ServerToClientProtocol.START_GAME: {
					this.listener.startGame();
					break;
				}
				case ServerToClientProtocol.HEARTBEAT: {
					this.listener.heartbeat();
					break;
				}
				case ServerToClientProtocol.DESYNC_DETECTED: {
					final int gameTurnTick = buffer.getInt();
					final int summaryLen = buffer.getInt();
					final byte[] summaryBytes = new byte[summaryLen];
					buffer.get(summaryBytes);
					final String summary = new String(summaryBytes, StandardCharsets.UTF_8);
					this.listener.desyncDetected(gameTurnTick, summary);
					break;
				}
				case ServerToClientProtocol.COMBINED_DESYNC_REPORT: {
					final int gameTurnTick = buffer.getInt();
					final int reportLen = buffer.getInt();
					final byte[] reportBytes = new byte[reportLen];
					buffer.get(reportBytes);
					final String report = new String(reportBytes, StandardCharsets.UTF_8);
					this.listener.combinedDesyncReport(gameTurnTick, report);
					break;
				}
				case ServerToClientProtocol.COMBINED_DESYNC_REPORT_CHUNK: {
					final int gameTurnTick = buffer.getInt();
					final int transferId = buffer.getInt();
					final int totalLen = buffer.getInt();
					final int offset = buffer.getInt();
					final int chunkLen = buffer.getInt();
					if (!validDiagnosticChunk(totalLen, offset, chunkLen, buffer.remaining())) {
						System.err.println("Ignoring invalid COMBINED_DESYNC_REPORT_CHUNK total=" + totalLen
								+ " offset=" + offset + " chunkLen=" + chunkLen + " remaining=" + buffer.remaining());
						break;
					}
					final DiagnosticChunkKey key = new DiagnosticChunkKey(gameTurnTick, transferId);
					DiagnosticChunkAssembly assembly = this.combinedReportChunks.get(key);
					if (assembly == null) {
						assembly = new DiagnosticChunkAssembly(totalLen);
						this.combinedReportChunks.put(key, assembly);
					}
					if (!assembly.accept(totalLen, offset, chunkLen, buffer)) {
						this.combinedReportChunks.remove(key);
						break;
					}
					if (assembly.isComplete()) {
						this.combinedReportChunks.remove(key);
						final String report = new String(assembly.bytes, StandardCharsets.UTF_8);
						this.listener.combinedDesyncReport(gameTurnTick, report);
					}
					break;
				}

				default:
					System.err.println("Got unknown protocol: " + protocol);
					break;
				}
			}
		}
		finally {
			buffer.position(initialLimit);
		}
	}

	private static boolean validDiagnosticChunk(final int totalLen, final int offset, final int chunkLen,
			final int remaining) {
		return (totalLen >= 0) && (totalLen <= MAX_DIAGNOSTIC_BYTES) && (offset >= 0) && (chunkLen >= 0)
				&& (chunkLen <= remaining) && (offset <= totalLen) && (offset + chunkLen <= totalLen);
	}

	private static final class DiagnosticChunkKey {
		private final int gameTurnTick;
		private final int transferId;

		private DiagnosticChunkKey(final int gameTurnTick, final int transferId) {
			this.gameTurnTick = gameTurnTick;
			this.transferId = transferId;
		}

		@Override
		public int hashCode() {
			return (31 * this.gameTurnTick) + this.transferId;
		}

		@Override
		public boolean equals(final Object obj) {
			if (this == obj) {
				return true;
			}
			if (!(obj instanceof DiagnosticChunkKey)) {
				return false;
			}
			final DiagnosticChunkKey other = (DiagnosticChunkKey) obj;
			return (this.gameTurnTick == other.gameTurnTick) && (this.transferId == other.transferId);
		}
	}

	private static final class DiagnosticChunkAssembly {
		private final byte[] bytes;
		private final boolean[] received;
		private int receivedCount;

		private DiagnosticChunkAssembly(final int totalLen) {
			this.bytes = new byte[totalLen];
			this.received = new boolean[totalLen];
		}

		private boolean accept(final int totalLen, final int offset, final int chunkLen, final ByteBuffer buffer) {
			if (totalLen != this.bytes.length) {
				System.err.println("Dropping diagnostic chunks with changed total length " + totalLen + " != "
						+ this.bytes.length);
				buffer.position(buffer.position() + chunkLen);
				return false;
			}
			buffer.get(this.bytes, offset, chunkLen);
			for (int i = offset; i < offset + chunkLen; i++) {
				if (!this.received[i]) {
					this.received[i] = true;
					this.receivedCount++;
				}
			}
			return true;
		}

		private boolean isComplete() {
			return this.receivedCount == this.bytes.length;
		}
	}
}
