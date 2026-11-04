import type { Dispatch, FormEvent, SetStateAction } from 'react';
import {
  ArrowLeft, LoaderCircle, MessageSquare, MoreVertical,
  Phone, Send, ShieldBan, Trash2, Video, VolumeX
} from 'lucide-react';

export type ChatPanelMember = {
  user_id: string;
  username: string;
  last_seen_at: string;
};

export type ChatPanelMessage = {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  hidden_for?: string[] | null;
};

export type ChatPanelSummary = {
  member: ChatPanelMember;
  lastMessage: ChatPanelMessage;
};

interface ChatPanelProps {
  mode: 'conversation' | 'history';
  selected: ChatPanelMember | null;
  messages: ChatPanelMessage[];
  chats: ChatPanelSummary[];
  userId: string | undefined;
  loadingMessages: boolean;
  loadingChats: boolean;
  sending: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  bottomRef: { current: HTMLDivElement | null };
  initials: (name: string) => string;
  callStatus: string;
  onStartCall: (kind: 'audio' | 'video') => void;
  chatMenuPeerId: string | null;
  onChatMenuPeerIdChange: Dispatch<SetStateAction<string | null>>;
  mutedPeerIds: string[];
  blockedPeerIds: string[];
  preferenceBusyPeerId: string | null;
  hidingChatPeerId: string | null;
  onToggleMute: (peerId: string) => void | Promise<void>;
  onToggleBlock: (peer: ChatPanelMember) => void | Promise<void>;
  onHideChat: (peerId: string) => void | Promise<void>;
  onSelectMember: (member: ChatPanelMember | null) => void;
  onClearMessages: () => void;
}

export default function ChatPanel({
  mode,
  selected,
  messages,
  chats,
  userId,
  loadingMessages,
  loadingChats,
  sending,
  draft,
  onDraftChange,
  onSendMessage,
  bottomRef,
  initials,
  callStatus,
  onStartCall,
  chatMenuPeerId,
  onChatMenuPeerIdChange,
  mutedPeerIds,
  blockedPeerIds,
  preferenceBusyPeerId,
  hidingChatPeerId,
  onToggleMute,
  onToggleBlock,
  onHideChat,
  onSelectMember,
  onClearMessages
}: ChatPanelProps) {
  if (mode === 'conversation' && selected) {
    return (
      <div className="aytar-communication-chat">
        <div className="aytar-communication-chathead">
          <button type="button" onClick={() => onSelectMember(null)} aria-label="Üyelere dön"><ArrowLeft size={17} /></button>
          <span className="aytar-communication-avatar">{initials(selected.username)}</span>
          <div><strong>{selected.username}</strong><small><i /> Çevrimiçi</small></div>
          <button type="button" className="aytar-communication-call" title="Sesli ara" onClick={() => onStartCall('audio')} disabled={callStatus !== 'idle'}><Phone size={16} /></button>
          <button type="button" className="aytar-communication-call" title="Görüntülü ara" onClick={() => onStartCall('video')} disabled={callStatus !== 'idle'}><Video size={16} /></button>
          <div style={{ position: 'relative' }}>
            <button type="button" aria-label="Sohbet seçenekleri" title="Sohbet seçenekleri" onClick={() => onChatMenuPeerIdChange(current => current === selected.user_id ? null : selected.user_id)} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 8 }}><MoreVertical size={18} /></button>
            {chatMenuPeerId === selected.user_id && <div role="menu" style={{ position: 'absolute', zIndex: 30, right: 0, top: '100%', minWidth: 190, padding: 5, borderRadius: 10, background: '#111827', border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
              <button type="button" role="menuitem" disabled={preferenceBusyPeerId === selected.user_id} onClick={() => void onToggleMute(selected.user_id)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', border: 0, borderRadius: 7, background: 'transparent', color: '#fff', cursor: 'pointer', textAlign: 'left' }}><VolumeX size={16} /> {mutedPeerIds.includes(selected.user_id) ? 'Sessizi Kaldır' : 'Sessize Al'}</button>
              <button type="button" role="menuitem" disabled={preferenceBusyPeerId === selected.user_id} onClick={() => void onToggleBlock(selected)} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', border: 0, borderRadius: 7, background: 'transparent', color: '#f87171', cursor: 'pointer', textAlign: 'left' }}><ShieldBan size={16} /> {blockedPeerIds.includes(selected.user_id) ? 'Engeli Kaldır' : 'Engelle'}</button>
            </div>}
          </div>
        </div>
        <div className="aytar-communication-messages">
          {loadingMessages ? <div className="aytar-communication-empty"><LoaderCircle className="gps-spinner" /> Mesajlar yükleniyor...</div>
            : messages.length === 0 ? <div className="aytar-communication-empty">Henüz mesaj yok.<br />İlk mesajı sen gönder.</div>
            : messages.map(message => <div key={message.id} className={`aytar-message-row ${message.sender_id === userId ? 'mine' : 'theirs'}`}>
              <p>{message.body}</p><time>{new Date(message.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time>
            </div>)}
          <div ref={element => { bottomRef.current = element; }} />
        </div>
        <form className="aytar-communication-compose" onSubmit={onSendMessage}>
          <textarea value={draft} onChange={event => onDraftChange(event.target.value)} placeholder="Mesaj yaz..." maxLength={4000} rows={1} />
          <button type="submit" disabled={!draft.trim() || sending} aria-label="Mesaj gönder">{sending ? <LoaderCircle className="gps-spinner" size={17} /> : <Send size={17} />}</button>
        </form>
      </div>
    );
  }

  if (mode === 'history') {
    return (
      <div className="aytar-communication-members">
        <div className="aytar-call-history-title"><strong>Sohbet geçmişi</strong></div>
        {loadingChats ? <div className="aytar-communication-empty"><LoaderCircle className="gps-spinner" /> Sohbetler yükleniyor...</div>
          : chats.length === 0 ? <div className="aytar-communication-empty aytar-communication-empty-tall">Henüz sohbet geçmişin yok.</div>
          : chats.map(chat => (
            <div key={chat.member.user_id} className="aytar-communication-member" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <button type="button" onClick={() => { onChatMenuPeerIdChange(null); onSelectMember(chat.member); onClearMessages(); }}
                style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 10, border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0 }}>
                <span className="aytar-communication-avatar">{initials(chat.member.username)}</span>
                <span className="aytar-communication-memberinfo"><strong>{chat.member.username}</strong><small>{chat.lastMessage.body}</small></span>
                {mutedPeerIds.includes(chat.member.user_id) && <span title="Sessize alındı" aria-label="Sessiz" style={{ display: 'inline-flex', color: '#9ca3af', marginLeft: 3 }}><VolumeX size={14} /></span>}
                <time>{new Date(chat.lastMessage.created_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })}</time>
              </button>
              <button type="button" aria-label={`${chat.member.username} sohbet seçenekleri`} title="Sohbet seçenekleri"
                onClick={() => onChatMenuPeerIdChange(current => current === chat.member.user_id ? null : chat.member.user_id)}
                style={{ flex: '0 0 auto', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 8 }}>
                <MoreVertical size={18} />
              </button>
              {chatMenuPeerId === chat.member.user_id && (
                <div role="menu" style={{ position: 'absolute', zIndex: 20, right: 8, top: 'calc(100% - 4px)', minWidth: 170, padding: 5, borderRadius: 10, background: '#111827', border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 8px 24px rgba(0,0,0,.35)' }}>
                  <button type="button" role="menuitem" onClick={() => { onChatMenuPeerIdChange(null); onSelectMember(chat.member); onClearMessages(); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', border: 0, borderRadius: 7, background: 'transparent', color: '#fff', cursor: 'pointer', textAlign: 'left' }}>
                    <MessageSquare size={16} /> Sohbete Git
                  </button>
                  <button type="button" role="menuitem" disabled={preferenceBusyPeerId === chat.member.user_id} onClick={() => void onToggleMute(chat.member.user_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', border: 0, borderRadius: 7, background: 'transparent', color: '#fff', cursor: 'pointer', textAlign: 'left' }}>
                    <VolumeX size={16} /> {mutedPeerIds.includes(chat.member.user_id) ? 'Sessizi Kaldır' : 'Sessize Al'}
                  </button>
                  <button type="button" role="menuitem" disabled={preferenceBusyPeerId === chat.member.user_id} onClick={() => void onToggleBlock(chat.member)}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', border: 0, borderRadius: 7, background: 'transparent', color: '#f87171', cursor: 'pointer', textAlign: 'left' }}>
                    <ShieldBan size={16} /> {blockedPeerIds.includes(chat.member.user_id) ? 'Engeli Kaldır' : 'Engelle'}
                  </button>
                  <button type="button" role="menuitem" disabled={hidingChatPeerId === chat.member.user_id} onClick={() => void onHideChat(chat.member.user_id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '9px 10px', border: 0, borderRadius: 7, background: 'transparent', color: '#f87171', cursor: 'pointer', textAlign: 'left' }}>
                    <Trash2 size={16} /> {hidingChatPeerId === chat.member.user_id ? 'Gizleniyor…' : 'Sohbeti Sil'}
                  </button>
                </div>
              )}
            </div>
          ))}
      </div>
    );
  }

  return null;
}
