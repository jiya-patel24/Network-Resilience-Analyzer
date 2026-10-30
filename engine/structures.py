"""
structures.py: hand-written data structures used by the engine
(Unit 5 heap, Unit 3 stack/queue, Unit 2 linked list). No library shortcuts.
"""


class MaxHeap:
    """Binary max-heap of (priority, item). Used for 'top threats' ranking."""

    def __init__(self):
        self._a = []

    def __len__(self):
        return len(self._a)

    def push(self, priority, item):
        self._a.append((priority, item))
        self._sift_up(len(self._a) - 1)

    def pop(self):
        if not self._a:
            return None
        top = self._a[0]
        last = self._a.pop()
        if self._a:
            self._a[0] = last
            self._sift_down(0)
        return top

    def peek(self):
        return self._a[0] if self._a else None

    def top_k(self, k):
        """Top-k entries without destroying the heap."""
        clone = MaxHeap()
        clone._a = list(self._a)
        return [clone.pop() for _ in range(min(k, len(clone)))]

    def _sift_up(self, i):
        a = self._a
        while i > 0:
            p = (i - 1) // 2
            if a[p][0] >= a[i][0]:
                break
            a[p], a[i] = a[i], a[p]
            i = p

    def _sift_down(self, i):
        a, n = self._a, len(self._a)
        while True:
            l, r, big = 2 * i + 1, 2 * i + 2, i
            if l < n and a[l][0] > a[big][0]:
                big = l
            if r < n and a[r][0] > a[big][0]:
                big = r
            if big == i:
                break
            a[i], a[big] = a[big], a[i]
            i = big


class Stack:
    def __init__(self):
        self._a = []

    def push(self, x):
        self._a.append(x)

    def pop(self):
        return self._a.pop() if self._a else None

    def peek(self):
        return self._a[-1] if self._a else None

    def is_empty(self):
        return not self._a

    def __len__(self):
        return len(self._a)


class Queue:
    """FIFO queue with O(1) dequeue (head index instead of list.pop(0))."""

    def __init__(self):
        self._a, self._head = [], 0

    def enqueue(self, x):
        self._a.append(x)

    def dequeue(self):
        if self.is_empty():
            return None
        x = self._a[self._head]
        self._head += 1
        if self._head > 32 and self._head * 2 > len(self._a):
            self._a = self._a[self._head:]
            self._head = 0
        return x

    def is_empty(self):
        return self._head >= len(self._a)

    def __len__(self):
        return len(self._a) - self._head


class _LNode:
    def __init__(self, value):
        self.value, self.next = value, None


class ChangeLog:
    """Singly linked list with a tail pointer: O(1) append, ordered history."""

    def __init__(self):
        self.head = self.tail = None
        self._size = 0

    def append(self, value):
        node = _LNode(value)
        if self.tail:
            self.tail.next = node
        else:
            self.head = node
        self.tail = node
        self._size += 1

    def to_list(self):
        out, cur = [], self.head
        while cur:
            out.append(cur.value)
            cur = cur.next
        return out

    def __len__(self):
        return self._size