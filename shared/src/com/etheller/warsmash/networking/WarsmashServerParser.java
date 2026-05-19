package com.etheller.warsmash.networking;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import net.warsmash.networking.udp.OrderedUdpServerListener;

public class WarsmashServerParser implements OrderedUdpServerListener {
	private static final int MAX_DIAGNOSTIC_BYTES = 1024 * 1024;

	private ClientToServerListener listener;
	private final Map<DiagnosticChunkKey, DiagnosticChunkAssembly> desyncDumpChunks = new HashMap<>();

	public WarsmashServerParser(final ClientToServerListener clientToServerListener) throws IOException {
		this.listener = clientToServerListener;
	}

	/**
	 * No-arg constructor for callers that need to break the construction
	 * cycle between {@link WarsmashServer}, this parser, and the underlying
	 * transport. Pair with {@link #setListener} after the {@link WarsmashServer}
	 * exists. Mirrors the same trick on the client side
	 * ({@link WarsmashClientParser}).
	 */
	public WarsmashServerParser() {
	}

	public void setListener(final ClientToServerListener listener) {
		this.listener = listener;
	}

	@Override
	public void parse(final Object sourceAddress, final ByteBuffer buffer) {
		final int initialLimit = buffer.limit();
		try {
			while (buffer.hasRemaining()) {
				final int length = buffer.getInt();
				if (length > buffer.remaining()) {
					// this packet is junk to us, so we will skip and continue (drop system will
					// handle it)
					System.err.println("Got mismatched protocol length " + length + " > " + buffer.remaining() + "!!");
					break;
				}
				final int protocol = buffer.getInt();
				switch (protocol) {
				case ClientToServerProtocol.ISSUE_TARGET_ORDER: {
					final long sessionToken = buffer.getLong();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final int targetHandleId = buffer.getInt();
					final boolean queue = buffer.get() == 1;
					this.listener.issueTargetOrder(sourceAddress, sessionToken, unitHandleId, abilityHandleId, orderId,
							targetHandleId, queue);
					break;
				}
				case ClientToServerProtocol.ISSUE_POINT_ORDER: {
					final long sessionToken = buffer.getLong();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final float x = buffer.getFloat();
					final float y = buffer.getFloat();
					final boolean queue = buffer.get() == 1;
					this.listener.issuePointOrder(sourceAddress, sessionToken, unitHandleId, abilityHandleId, orderId,
							x, y, queue);
					break;
				}
				case ClientToServerProtocol.ISSUE_DROP_ITEM_ORDER: {
					final long sessionToken = buffer.getLong();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final int targetHandleId = buffer.getInt();
					final float x = buffer.getFloat();
					final float y = buffer.getFloat();
					final boolean queue = buffer.get() == 1;
					this.listener.issueDropItemAtPointOrder(sourceAddress, sessionToken, unitHandleId, abilityHandleId,
							orderId, targetHandleId, x, y, queue);
					break;
				}
				case ClientToServerProtocol.ISSUE_DROP_ITEM_ON_TARGET_ORDER: {
					final long sessionToken = buffer.getLong();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final int targetHandleId = buffer.getInt();
					final int targetHeroHandleId = buffer.getInt();
					final boolean queue = buffer.get() == 1;
					this.listener.issueDropItemAtTargetOrder(sourceAddress, sessionToken, unitHandleId, abilityHandleId,
							orderId, targetHandleId, targetHeroHandleId, queue);
					break;
				}
				case ClientToServerProtocol.ISSUE_IMMEDIATE_ORDER: {
					final long sessionToken = buffer.getLong();
					final int unitHandleId = buffer.getInt();
					final int abilityHandleId = buffer.getInt();
					final int orderId = buffer.getInt();
					final boolean queue = buffer.get() == 1;
					this.listener.issueImmediateOrder(sourceAddress, sessionToken, unitHandleId, abilityHandleId,
							orderId, queue);
					break;
				}
				case ClientToServerProtocol.UNIT_CANCEL_TRAINING: {
					final long sessionToken = buffer.getLong();
					final int unitHandleId = buffer.getInt();
					final int cancelIndex = buffer.getInt();
					this.listener.unitCancelTrainingItem(sourceAddress, sessionToken, unitHandleId, cancelIndex);
					break;
				}
				case ClientToServerProtocol.ISSUE_GUI_PLAYER_EVENT: {
					final long sessionToken = buffer.getLong();
					final int eventId = buffer.getInt();
					this.listener.issueGuiPlayerEvent(sourceAddress, sessionToken, eventId);
					break;
				}
				case ClientToServerProtocol.FINISHED_TURN: {
					final long sessionToken = buffer.getLong();
					final int gameTurnTick = buffer.getInt();
					this.listener.finishedTurn(sourceAddress, sessionToken, gameTurnTick);
					break;
				}
				case ClientToServerProtocol.JOIN_GAME: {
					final long sessionToken = buffer.getLong();
					this.listener.joinGame(sourceAddress, sessionToken);
					break;
				}
				case ClientToServerProtocol.FRAMES_SKIPPED: {
					final long sessionToken = buffer.getLong();
					final int nFramesSkipped = buffer.getInt();
					this.listener.framesSkipped(sessionToken, nFramesSkipped);
					break;
				}
				case ClientToServerProtocol.STATE_HASH: {
					final long sessionToken = buffer.getLong();
					final int gameTurnTick = buffer.getInt();
					final long stateHash = buffer.getLong();
					this.listener.stateHash(sourceAddress, sessionToken, gameTurnTick, stateHash);
					break;
				}
				case ClientToServerProtocol.DESYNC_DUMP: {
					final long sessionToken = buffer.getLong();
					final int gameTurnTick = buffer.getInt();
					final int dumpLen = buffer.getInt();
					final byte[] dumpBytes = new byte[dumpLen];
					buffer.get(dumpBytes);
					final String dump = new String(dumpBytes, StandardCharsets.UTF_8);
					this.listener.desyncDump(sourceAddress, sessionToken, gameTurnTick, dump);
					break;
				}
				case ClientToServerProtocol.DESYNC_DUMP_CHUNK: {
					final long sessionToken = buffer.getLong();
					final int gameTurnTick = buffer.getInt();
					final int transferId = buffer.getInt();
					final int totalLen = buffer.getInt();
					final int offset = buffer.getInt();
					final int chunkLen = buffer.getInt();
					if (!validDiagnosticChunk(totalLen, offset, chunkLen, buffer.remaining())) {
						System.err.println("Ignoring invalid DESYNC_DUMP_CHUNK total=" + totalLen + " offset=" + offset
								+ " chunkLen=" + chunkLen + " remaining=" + buffer.remaining());
						break;
					}
					final DiagnosticChunkKey key = new DiagnosticChunkKey(sourceAddress, sessionToken, gameTurnTick,
							transferId);
					DiagnosticChunkAssembly assembly = this.desyncDumpChunks.get(key);
					if (assembly == null) {
						assembly = new DiagnosticChunkAssembly(totalLen);
						this.desyncDumpChunks.put(key, assembly);
					}
					if (!assembly.accept(totalLen, offset, chunkLen, buffer)) {
						this.desyncDumpChunks.remove(key);
						break;
					}
					if (assembly.isComplete()) {
						this.desyncDumpChunks.remove(key);
						final String dump = new String(assembly.bytes, StandardCharsets.UTF_8);
						this.listener.desyncDump(sourceAddress, sessionToken, gameTurnTick, dump);
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

	@Override
	public void cantReplay(final Object sourceAddress, final int seqNo) {
		throw new IllegalStateException("Cant replay " + seqNo + " to " + sourceAddress + " !");
	}

	private static boolean validDiagnosticChunk(final int totalLen, final int offset, final int chunkLen,
			final int remaining) {
		return (totalLen >= 0) && (totalLen <= MAX_DIAGNOSTIC_BYTES) && (offset >= 0) && (chunkLen >= 0)
				&& (chunkLen <= remaining) && (offset <= totalLen) && (offset + chunkLen <= totalLen);
	}

	private static final class DiagnosticChunkKey {
		private final Object sourceAddress;
		private final long sessionToken;
		private final int gameTurnTick;
		private final int transferId;

		private DiagnosticChunkKey(final Object sourceAddress, final long sessionToken, final int gameTurnTick,
				final int transferId) {
			this.sourceAddress = sourceAddress;
			this.sessionToken = sessionToken;
			this.gameTurnTick = gameTurnTick;
			this.transferId = transferId;
		}

		@Override
		public int hashCode() {
			int result = this.sourceAddress == null ? 0 : this.sourceAddress.hashCode();
			result = (31 * result) + (int) (this.sessionToken ^ (this.sessionToken >>> 32));
			result = (31 * result) + this.gameTurnTick;
			result = (31 * result) + this.transferId;
			return result;
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
			if (this.sessionToken != other.sessionToken || this.gameTurnTick != other.gameTurnTick
					|| this.transferId != other.transferId) {
				return false;
			}
			return this.sourceAddress == null ? other.sourceAddress == null : this.sourceAddress.equals(other.sourceAddress);
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
