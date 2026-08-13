@echo off

:: 仓库路径
:: set "REPO_PATH=%cd%"

:: 进入仓库目录
:: cd /d "%REPO_PATH%" || exit /b

:: 开始格式化日期时间
set "sysdate=%date%"
echo %sysdate%

set "systime=%time%"
echo %systime%

set "date_time=%sysdate:~0,4%-%sysdate:~5,2%-%sysdate:~8,2% %systime:~0,2%:%systime:~3,2%"

:: 打印结果
echo %date_time%
:: 结束格式化日期时间

:: pull更新代码
git pull

:: 添加所有更改
git add -A

:: 提交更改
git commit -sm "[config] update home config %date_time%"

:: 检查git commit是否成功
if %errorlevel% equ 0 (
    echo code commit success

    :: pull rebase更新代码
    git pull --rebase
    :: 推送到远程仓库
    git push
) else (
    echo code commit fail
)

:: 检查git push是否成功
if %errorlevel% equ 0 (
    echo code push success

    :: pull rebase更新代码 again
    git pull --rebase
    echo code pull lastest
) else (
    echo code push fail
)
pause