<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>タスク管理アプリ</title>
  <style>
    body { font-family: sans-serif; background: #f4f4f4; margin: 0; padding: 0; }
    .container { max-width: 400px; margin: 40px auto; background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px #0001; }
    h1 { text-align: center; }
    form { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    input[type="text"], input[type="datetime-local"], input[type="number"] { flex: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 8px 16px; border: none; background: #1976d2; color: #fff; border-radius: 4px; cursor: pointer; }
    ul { list-style: none; padding: 0; }
    li { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    li:last-child { border-bottom: none; }
    .completed { text-decoration: line-through; color: #888; }
    .delete-btn { background: #e53935; margin-left: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>タスク管理</h1>
    <form id="task-form">
      <input type="text" id="task-input" placeholder="タスクタイトル" required />
      <input type="text" id="task-detail-input" placeholder="タスクの詳細" required />
      <input type="datetime-local" id="datetime-input" required />
      <label>重要度:
        <input type="number" id="priority-input" min="1" max="10" value="5" required />
      </label>
      <label>達成難易度:
        <input type="number" id="difficulty-input" min="1" max="10" value="5" required />
      </label>
      <button type="submit">追加</button>
    </form>
    <div id="tasks-by-date"></div>
    <button id="show-reviewed-btn" type="button">振り返り済み</button>
    <div id="reviewed-tasks" style="display:none;"></div>
  </div>
  <script>
    const form = document.getElementById('task-form');
    const input = document.getElementById('task-input');
    const detailInput = document.getElementById('task-detail-input');
    const datetimeInput = document.getElementById('datetime-input');
    const priorityInput = document.getElementById('priority-input');
    const difficultyInput = document.getElementById('difficulty-input');
    const tasksByDateDiv = document.getElementById('tasks-by-date');
    let tasks = {};
    let reviewedTasks = [];

    // 通知許可リクエスト
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }

    function sendTaskNotification(task) {
      if ('Notification' in window && Notification.permission === 'granted') {
        const timeStr = `${String(task.hour).padStart(2, '0')}:${String(task.minute).padStart(2, '0')}`;
        new Notification('タスク通知', {
          body: `${timeStr} ${task.text} (重要度:${task.priority}, 難易度:${task.difficulty})`,
        });
      }
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const text = input.value.trim();
      const detail = detailInput.value.trim();
      const datetime = datetimeInput.value;
      const priority = parseInt(priorityInput.value, 10);
      const difficulty = parseInt(difficultyInput.value, 10);
      if (text && detail && datetime && priority && difficulty) {
        // 日付と時刻を分離
        const [date, time] = datetime.split('T');
        const [hour, minute] = time.split(':').map(Number);
        if (!tasks[date]) tasks[date] = [];
        tasks[date].push({ text, detail, priority, difficulty, hour, minute });
        sendTaskNotification({ text, detail, priority, difficulty, hour, minute });
        input.value = '';
        detailInput.value = '';
        datetimeInput.value = '';
        priorityInput.value = '5';
        difficultyInput.value = '5';
        renderTasks();
      }
    });

    function renderTasks() {
      tasksByDateDiv.innerHTML = '';
      const dates = Object.keys(tasks).sort();
      dates.forEach(date => {
        const section = document.createElement('section');
        const h2 = document.createElement('h2');
        h2.textContent = date;
        section.appendChild(h2);
        const ul = document.createElement('ul');
        tasks[date].slice().sort((a, b) => b.priority - a.priority).forEach((taskObj, idx) => {
          // 振り返り済みはToDoリストから除外
          if (taskObj.review && taskObj.review.achieved) return;
          const li = document.createElement('li');
          // 時刻
          const timeSpan = document.createElement('span');
          timeSpan.textContent = `${String(taskObj.hour).padStart(2, '0')}:${String(taskObj.minute).padStart(2, '0')}`;
          timeSpan.style.fontWeight = 'bold';
          timeSpan.style.color = '#1976d2';
          timeSpan.style.marginRight = '10px';
          // 重要度グラデーション色の●
          const gradSpan = document.createElement('span');
          gradSpan.textContent = '●';
          gradSpan.style.fontSize = '1.5em';
          gradSpan.style.margin = '0 10px 0 0';
          gradSpan.style.verticalAlign = 'middle';
          gradSpan.style.filter = 'drop-shadow(0 0 2px #0003)';
          // 赤(高)～青(低)のグラデーション
          // priority: 1(青)～10(赤)
          const r = Math.round(23 + (255-23) * (taskObj.priority-1)/9); // 23→255
          const g = Math.round(105 - 105 * (taskObj.priority-1)/9);     // 105→0
          const b = Math.round(255 - 255 * (taskObj.priority-1)/9);     // 255→0
          gradSpan.style.color = `rgb(${r},${g},${b})`;
          gradSpan.style.textShadow = `0 0 4px rgba(${r},${g},${b},0.7)`;
          // タイトル
          const titleSpan = document.createElement('span');
          titleSpan.textContent = taskObj.text;
          titleSpan.style.fontSize = '1.1em';
          titleSpan.style.fontWeight = 'bold';
          titleSpan.style.marginRight = '10px';
          titleSpan.addEventListener('click', () => {
            titleSpan.classList.toggle('completed');
          });
          // 詳細
          const detailSpan = document.createElement('span');
          detailSpan.textContent = taskObj.detail ? `（${taskObj.detail}）` : '';
          detailSpan.style.color = '#555';
          detailSpan.style.marginRight = '10px';
          // 情報
          const infoSpan = document.createElement('span');
          infoSpan.textContent = `[重要度:${taskObj.priority}, 難易度:${taskObj.difficulty}]`;
          infoSpan.style.color = '#888';
          // 編集ボタン
          const editBtn = document.createElement('button');
          editBtn.textContent = '編集';
          editBtn.className = 'edit-btn';
          editBtn.onclick = () => {
            // 編集用フォームを表示
            const editForm = document.createElement('form');
            editForm.style.display = 'flex';
            editForm.style.gap = '4px';
            const textInput = document.createElement('input');
            textInput.type = 'text';
            textInput.value = taskObj.text;
            textInput.required = true;
            const detailInputEdit = document.createElement('input');
            detailInputEdit.type = 'text';
            detailInputEdit.value = taskObj.detail || '';
            detailInputEdit.placeholder = 'タスクの詳細';
            detailInputEdit.required = true;
            const hourInput = document.createElement('input');
            hourInput.type = 'number';
            hourInput.min = 0;
            hourInput.max = 23;
            hourInput.value = taskObj.hour;
            hourInput.required = true;
            hourInput.style.width = '60px';
            const minuteInput = document.createElement('input');
            minuteInput.type = 'number';
            minuteInput.min = 0;
            minuteInput.max = 59;
            minuteInput.value = taskObj.minute;
            minuteInput.required = true;
            minuteInput.style.width = '60px';
            const priorityInput = document.createElement('input');
            priorityInput.type = 'number';
            priorityInput.min = 1;
            priorityInput.max = 10;
            priorityInput.value = taskObj.priority;
            priorityInput.required = true;
            priorityInput.style.width = '60px';
            const difficultyInput = document.createElement('input');
            difficultyInput.type = 'number';
            difficultyInput.min = 1;
            difficultyInput.max = 10;
            difficultyInput.value = taskObj.difficulty;
            difficultyInput.required = true;
            difficultyInput.style.width = '60px';
            const saveBtn = document.createElement('button');
            saveBtn.type = 'submit';
            saveBtn.textContent = '保存';
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.textContent = 'キャンセル';
            cancelBtn.onclick = () => renderTasks();
            editForm.appendChild(textInput);
            editForm.appendChild(detailInputEdit);
            editForm.appendChild(hourInput);
            editForm.appendChild(minuteInput);
            editForm.appendChild(priorityInput);
            editForm.appendChild(difficultyInput);
            editForm.appendChild(saveBtn);
            editForm.appendChild(cancelBtn);
            li.innerHTML = '';
            li.appendChild(editForm);
            editForm.onsubmit = (e) => {
              e.preventDefault();
              // 編集内容を保存
              taskObj.text = textInput.value;
              taskObj.detail = detailInputEdit.value;
              taskObj.hour = parseInt(hourInput.value, 10);
              taskObj.minute = parseInt(minuteInput.value, 10);
              taskObj.priority = parseInt(priorityInput.value, 10);
              taskObj.difficulty = parseInt(difficultyInput.value, 10);
              renderTasks();
            };
          };

          const delBtn = document.createElement('button');
          delBtn.textContent = '削除';
          delBtn.className = 'delete-btn';
          delBtn.onclick = () => {
            // 削除時は元の配列のインデックスで削除
            const realIdx = tasks[date].findIndex(t => t === taskObj);
            tasks[date].splice(realIdx, 1);
            if (tasks[date].length === 0) delete tasks[date];
            renderTasks();
          };
          li.appendChild(timeSpan);
          li.appendChild(gradSpan);
          li.appendChild(titleSpan);
          li.appendChild(detailSpan);
          li.appendChild(infoSpan);
          li.appendChild(editBtn);
          li.appendChild(delBtn);
          ul.appendChild(li);
        });
        section.appendChild(ul);
        tasksByDateDiv.appendChild(section);
      });
    }

    function renderReviewedTasks() {
      const reviewedDiv = document.getElementById('reviewed-tasks');
      reviewedDiv.innerHTML = '';
      if (reviewedTasks.length === 0) {
        reviewedDiv.textContent = '（振り返り済みのタスクはありません）';
        return;
      }
      const ul = document.createElement('ul');
      reviewedTasks.forEach(taskObj => {
        const li = document.createElement('li');
        // タイトル、時刻、達成/未達成、詳細
        li.innerHTML = `<strong>${taskObj.text}</strong> <span style="color:#1976d2;">${String(taskObj.hour).padStart(2, '0')}:${String(taskObj.minute).padStart(2, '0')}</span> <span>[${taskObj.review.achieved}]</span> <span style="color:#555;">${taskObj.detail}</span>`;
        ul.appendChild(li);
      });
      reviewedDiv.appendChild(ul);
    }

    // 振り返り済みボタン
    const reviewedBtn = document.getElementById('show-reviewed-btn');
    const reviewedDiv = document.getElementById('reviewed-tasks');
    reviewedBtn.onclick = function() {
      if (tasksByDateDiv.style.display === 'none' || tasksByDateDiv.style.display === '') {
        tasksByDateDiv.style.display = 'block';
        reviewedDiv.style.display = 'none';
        reviewedBtn.textContent = '振り返り済み';
      } else {
        tasksByDateDiv.style.display = 'none';
        reviewedDiv.style.display = 'block';
        reviewedBtn.textContent = 'ToDoリスト';
        renderReviewedTasks();
      }
    };

    // 振り返り保存時にreviewedTasksへ追加
    function saveReview(date, idx, reviewDiv) {
      const achievedRadio = reviewDiv.querySelector('input[name^="achieved"]:checked');
      const reviewInput = reviewDiv.querySelector('input[type="text"]');
      const taskObj = tasks[date][idx];
      taskObj.review = {
        achieved: achievedRadio ? achievedRadio.value : '',
        detail: reviewInput.value
      };
      if (taskObj.review.achieved) {
        reviewedTasks.push({...taskObj});
        tasks[date].splice(idx, 1);
        if (tasks[date].length === 0) delete tasks[date];
      }
      renderTasks();
    }
  </script>
</body>
</html>
