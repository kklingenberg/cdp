#!/bin/sh

rate=$1
size=$2

if test -z "$rate" ; then echo "Specify a rate in Hz" ; exit 1 ; fi
if test -z "$size" ; then echo "Specify a chunk size" ; exit 1 ; fi

send_chunk() {
    chunk_number=$1
    echo -n "${size}" | jq -c '
    range(.) | now | . * 1000000 | ceil | if fmod(.; 3) == 0
    then {n: "mutiple.of.three", d: .}
    else {n: "not.multiple.of.three", d: .}
    end
    ' | curl --data-binary @- http://cdp:8000/events
    if test "$?" -eq "0"
    then
        if test "$(($chunk_number%300))" -eq "0"
        then
            echo "Successfully sent chunk #${chunk_number} to CDP"
        fi
    else
        echo "Failed to send chunk to CDP"
    fi
}

period=$((1000000 / $rate))
chunks_sent=0

while :
do
    chunks_sent=$(($chunks_sent + 1))
    send_chunk "${chunks_sent}" &
    usleep "${period}"
done
